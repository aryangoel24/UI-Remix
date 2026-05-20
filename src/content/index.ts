import { EditorOverlay } from './editorOverlay';
import { createCommandRulePreview, createCommandRulePreviewForElement } from './commandResolver';
import { getCurrentDomain } from '../shared/domain';
import { applyRule, applyRules, removeRule } from '../shared/ruleEngine';
import {
  createHideRule,
  createStyleRule,
  createTextRule
} from '../shared/ruleFactory';
import { generateSelector } from '../shared/selector';
import { getRulesForDomain, saveRule } from '../shared/storage';
import type {
  CommandRulePreview,
  ContentMessage,
  ContentMessageResponse,
  ParsedCommand,
  UIRule,
  UIStyleDeclaration
} from '../shared/types';

declare global {
  interface Window {
    __UI_REMIX_CONTENT_INSTALLED__?: boolean;
  }
}

const APPLY_RULES_DEBOUNCE_MS = 180;
const COMMAND_PICK_HOST_ID = 'ui-remix-command-pick-root';

const domain = getCurrentDomain() || window.location.origin;
let editModeEnabled = false;
let selectedElement: HTMLElement | null = null;
let overlay: EditorOverlay | null = null;
let cachedRules: UIRule[] = [];
let applyTimer: number | undefined;
let applyingRules = false;
let observer: MutationObserver | null = null;
let pendingCommandPreview: CommandRulePreview | null = null;
let commandPickSession: CommandPickSession | null = null;

interface CommandPickSession {
  command: string;
  parsed: ParsedCommand;
  host: HTMLDivElement;
  hoverBox: HTMLDivElement;
}

if (window.__UI_REMIX_CONTENT_INSTALLED__) {
  console.info('[UI Remix] Content script already installed.');
} else {
  window.__UI_REMIX_CONTENT_INSTALLED__ = true;
  void initialize();
}

async function initialize(): Promise<void> {
  await reloadRules();
  startRuleObserver();
  installMessageListener();
}

function installMessageListener(): void {
  chrome.runtime.onMessage.addListener((message: ContentMessage, _sender, sendResponse) => {
    void handleMessage(message)
      .then(sendResponse)
      .catch((error) => {
        console.warn('[UI Remix] Message handling failed', error);
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      });

    return true;
  });
}

async function handleMessage(message: ContentMessage): Promise<ContentMessageResponse> {
  switch (message.type) {
    case 'UI_REMIX_ENABLE_EDIT_MODE':
      enableEditMode();
      return { ok: true, editMode: true };
    case 'UI_REMIX_DISABLE_EDIT_MODE':
      disableEditMode();
      return { ok: true, editMode: false };
    case 'UI_REMIX_GET_EDIT_MODE_STATUS':
      return { ok: true, editMode: editModeEnabled };
    case 'UI_REMIX_RELOAD_RULES':
      await reloadRules();
      return { ok: true, editMode: editModeEnabled };
    case 'UI_REMIX_REMOVE_RULE':
      removeRule(message.ruleId);
      await reloadRules();
      return { ok: true, editMode: editModeEnabled };
    case 'UI_REMIX_PREVIEW_COMMAND': {
      const result = createCommandRulePreview(message.command, domain, selectedElement);
      if (!result.ok) {
        return { ok: false, editMode: editModeEnabled, error: result.error };
      }

      if (result.preview.needsElementPick) {
        startCommandPickMode(message.command, result.preview.parsed);
      } else {
        stopCommandPickMode();
        pendingCommandPreview = null;
      }

      return { ok: true, editMode: editModeEnabled, preview: result.preview };
    }
    case 'UI_REMIX_GET_PENDING_COMMAND_PREVIEW':
      return { ok: true, editMode: editModeEnabled, preview: pendingCommandPreview ?? undefined };
    case 'UI_REMIX_APPLY_COMMAND_RULES':
      if (message.rules.length === 0) {
        return {
          ok: false,
          editMode: editModeEnabled,
          error: 'No rules were provided.'
        };
      }

      if (message.rules.some((rule) => rule.domain !== domain)) {
        return {
          ok: false,
          editMode: editModeEnabled,
          error: 'One or more rules belong to a different domain.'
        };
      }

      for (const rule of message.rules) {
        await persistAndApplyRule(rule, { showAlert: false, rethrow: true });
      }

      pendingCommandPreview = null;
      stopCommandPickMode();
      return { ok: true, editMode: editModeEnabled, rules: message.rules };
  }
}

function enableEditMode(): void {
  if (editModeEnabled) {
    return;
  }

  stopCommandPickMode();
  editModeEnabled = true;
  overlay = new EditorOverlay({
    onHide: () => void handleHideAction(),
    onChangeText: () => void handleChangeTextAction(),
    onResize: () => void handleResizeAction(),
    onStyleSubmit: (styles) => void handleStyleAction(styles),
    onCancel: clearSelection
  });
  overlay.mount();

  document.addEventListener('mousemove', handleMouseMove, true);
  document.addEventListener('click', handlePageClick, true);
  document.addEventListener('keydown', handleKeyDown, true);
  console.info('[UI Remix] Edit mode enabled.');
}

function disableEditMode(): void {
  if (!editModeEnabled) {
    return;
  }

  editModeEnabled = false;
  selectedElement = null;
  document.removeEventListener('mousemove', handleMouseMove, true);
  document.removeEventListener('click', handlePageClick, true);
  document.removeEventListener('keydown', handleKeyDown, true);
  overlay?.destroy();
  overlay = null;
  console.info('[UI Remix] Edit mode disabled.');
}

function handleMouseMove(event: MouseEvent): void {
  if (!editModeEnabled || overlay?.isOverlayEvent(event)) {
    return;
  }

  const element = getPageElementFromEvent(event);
  overlay?.showHover(element);
}

function handlePageClick(event: MouseEvent): void {
  if (!editModeEnabled || overlay?.isOverlayEvent(event)) {
    return;
  }

  const element = getPageElementFromEvent(event);
  if (!element) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  selectedElement = element;
  overlay?.select(element);
}

function handleKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    clearSelection();
  }
}

function startCommandPickMode(command: string, parsed: ParsedCommand): void {
  stopCommandPickMode();
  disableEditMode();
  pendingCommandPreview = null;

  const host = document.createElement('div');
  host.id = COMMAND_PICK_HOST_ID;
  host.dataset.uiRemixRoot = 'true';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = commandPickMarkup();

  const hoverBox = shadow.querySelector<HTMLDivElement>('[data-command-hover-box]');
  if (!hoverBox) {
    return;
  }

  commandPickSession = {
    command,
    parsed,
    host,
    hoverBox
  };

  document.documentElement.appendChild(host);
  document.addEventListener('mousemove', handleCommandPickMouseMove, true);
  document.addEventListener('click', handleCommandPickClick, true);
  document.addEventListener('keydown', handleCommandPickKeyDown, true);
}

function stopCommandPickMode(): void {
  if (!commandPickSession) {
    return;
  }

  document.removeEventListener('mousemove', handleCommandPickMouseMove, true);
  document.removeEventListener('click', handleCommandPickClick, true);
  document.removeEventListener('keydown', handleCommandPickKeyDown, true);
  commandPickSession.host.remove();
  commandPickSession = null;
}

function handleCommandPickMouseMove(event: MouseEvent): void {
  const element = getPageElementFromEvent(event);
  const hoverBox = commandPickSession?.hoverBox;
  if (!hoverBox) {
    return;
  }

  if (!element) {
    hoverBox.hidden = true;
    return;
  }

  const rect = element.getBoundingClientRect();
  hoverBox.hidden = false;
  hoverBox.style.transform = `translate(${Math.max(0, rect.left)}px, ${Math.max(0, rect.top)}px)`;
  hoverBox.style.width = `${rect.width}px`;
  hoverBox.style.height = `${rect.height}px`;
}

function handleCommandPickClick(event: MouseEvent): void {
  const session = commandPickSession;
  if (!session) {
    return;
  }

  const element = getPageElementFromEvent(event);
  if (!element) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  pendingCommandPreview = createCommandRulePreviewForElement(
    session.command,
    domain,
    session.parsed,
    element
  );
  stopCommandPickMode();
  showCommandPickConfirmation();
}

function handleCommandPickKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    stopCommandPickMode();
  }
}

function commandPickMarkup(): string {
  return `
    <style>
      :host {
        all: initial;
        position: fixed;
        inset: 0;
        pointer-events: none;
        z-index: 2147483647;
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      [hidden] {
        display: none !important;
      }

      .hover-box {
        position: fixed;
        top: 0;
        left: 0;
        box-sizing: border-box;
        border: 2px solid #0f766e;
        border-radius: 4px;
        background: rgba(15, 118, 110, 0.08);
        box-shadow: 0 0 0 3px rgba(15, 118, 110, 0.16);
      }

      .toast {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        max-width: min(420px, calc(100vw - 24px));
        padding: 10px 12px;
        border: 1px solid rgba(15, 118, 110, 0.28);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.98);
        color: #115e59;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.2);
        font-size: 13px;
        font-weight: 750;
        line-height: 1.35;
        pointer-events: none;
      }
    </style>
    <div class="hover-box" data-command-hover-box hidden></div>
    <div class="toast">Click the element you want this command to apply to. Press Escape to cancel.</div>
  `;
}

function showCommandPickConfirmation(): void {
  const host = document.createElement('div');
  host.dataset.uiRemixRoot = 'true';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        position: fixed;
        z-index: 2147483647;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        max-width: min(420px, calc(100vw - 24px));
        padding: 10px 12px;
        border: 1px solid rgba(15, 118, 110, 0.28);
        border-radius: 8px;
        background: rgba(255, 255, 255, 0.98);
        color: #115e59;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.2);
        font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        font-weight: 750;
        line-height: 1.35;
      }
    </style>
    Rule preview ready. Open UI Remix again to review and apply it.
  `;

  document.documentElement.appendChild(host);
  window.setTimeout(() => {
    host.remove();
  }, 4500);
}

async function handleHideAction(): Promise<void> {
  const element = getSelectedElement();
  if (!element) {
    return;
  }

  const selector = getSelectorForElement(element);
  if (!selector) {
    return;
  }

  const rule = createHideRule(domain, selector);
  await persistAndApplyRule(rule);
  clearSelection();
}

async function handleChangeTextAction(): Promise<void> {
  const element = getSelectedElement();
  if (!element) {
    return;
  }

  const nextText = window.prompt('New text', element.textContent?.trim() ?? '');
  if (nextText === null) {
    return;
  }

  const selector = getSelectorForElement(element);
  if (!selector) {
    return;
  }

  const rule = createTextRule(domain, selector, nextText);
  await persistAndApplyRule(rule);
  clearSelection();
}

async function handleStyleAction(styles: UIStyleDeclaration): Promise<void> {
  const element = getSelectedElement();
  if (!element) {
    return;
  }

  if (Object.values(styles).every((value) => !value)) {
    window.alert('Add at least one style value.');
    return;
  }

  const selector = getSelectorForElement(element);
  if (!selector) {
    return;
  }

  const rule = createStyleRule(domain, selector, styles);
  await persistAndApplyRule(rule);
  clearSelection();
}

async function handleResizeAction(): Promise<void> {
  const element = getSelectedElement();
  if (!element) {
    return;
  }

  const computed = window.getComputedStyle(element);
  const width = window.prompt('Width (for example: 320px, 50%, auto)', computed.width);
  if (width === null) {
    return;
  }

  const height = window.prompt('Height (for example: 160px, auto)', computed.height);
  if (height === null) {
    return;
  }

  const styles: UIStyleDeclaration = {
    width: width.trim() || undefined,
    height: height.trim() || undefined
  };

  if (!styles.width && !styles.height) {
    window.alert('Enter a width or height.');
    return;
  }

  const selector = getSelectorForElement(element);
  if (!selector) {
    return;
  }

  const rule = createStyleRule(domain, selector, styles);
  await persistAndApplyRule(rule);
  clearSelection();
}

function clearSelection(): void {
  selectedElement = null;
  overlay?.clearSelection();
}

function getSelectedElement(): HTMLElement | null {
  if (!selectedElement) {
    console.warn('[UI Remix] No selected element.');
    window.alert('No element is selected.');
    return null;
  }

  if (!selectedElement.isConnected) {
    console.warn('[UI Remix] Selected element no longer exists.');
    window.alert('The selected element is no longer on the page.');
    clearSelection();
    return null;
  }

  return selectedElement;
}

function getSelectorForElement(element: HTMLElement): string | null {
  try {
    const selector = generateSelector(element);
    document.querySelector(selector);
    return selector;
  } catch (error) {
    console.warn('[UI Remix] Could not generate a selector', error);
    window.alert('UI Remix could not create a selector for this element.');
    return null;
  }
}

async function persistAndApplyRule(
  rule: UIRule,
  options: { showAlert?: boolean; rethrow?: boolean } = {}
): Promise<void> {
  try {
    await saveRule(rule);
    applyRuleSafely(rule);
    cachedRules = upsertRule(cachedRules, rule);
  } catch (error) {
    console.warn('[UI Remix] Could not save rule', error);
    if (options.showAlert !== false) {
      window.alert('UI Remix could not save this rule.');
    }

    if (options.rethrow) {
      throw error;
    }
  }
}

async function reloadRules(): Promise<void> {
  try {
    cachedRules = await getRulesForDomain(domain);
    applyCachedRules();
  } catch (error) {
    console.warn('[UI Remix] Could not load saved rules', error);
  }
}

function applyRuleSafely(rule: UIRule): void {
  applyingRules = true;
  try {
    applyRule(rule);
  } finally {
    window.setTimeout(() => {
      applyingRules = false;
    }, 0);
  }
}

function applyCachedRules(): void {
  applyingRules = true;
  try {
    applyRules(cachedRules);
  } finally {
    window.setTimeout(() => {
      applyingRules = false;
    }, 0);
  }
}

function scheduleRuleApplication(): void {
  if (applyingRules || cachedRules.length === 0) {
    return;
  }

  window.clearTimeout(applyTimer);
  applyTimer = window.setTimeout(() => {
    applyCachedRules();
  }, APPLY_RULES_DEBOUNCE_MS);
}

function startRuleObserver(): void {
  const root = document.documentElement || document.body;
  if (!root || observer) {
    return;
  }

  observer = new MutationObserver((mutations) => {
    if (mutations.some((mutation) => mutation.addedNodes.length > 0)) {
      scheduleRuleApplication();
    }
  });

  observer.observe(root, {
    childList: true,
    subtree: true
  });
}

function getPageElementFromEvent(event: MouseEvent): HTMLElement | null {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return null;
  }

  if (target.closest('[data-ui-remix-root="true"]')) {
    return null;
  }

  return target;
}

function upsertRule(rules: UIRule[], rule: UIRule): UIRule[] {
  return [...rules.filter((existing) => existing.id !== rule.id), rule];
}
