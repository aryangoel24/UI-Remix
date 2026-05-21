import { parseCommand } from '../shared/commandParser';
import { createHideRule, createStyleRule, createTextRule } from '../shared/ruleFactory';
import { generateSelector } from '../shared/selector';
import type {
  CommandRulePreview,
  CommandRulePreviewItem,
  ParsedCommand,
  UIRule,
  UIStyleDeclaration
} from '../shared/types';

type CommandResolution =
  | {
      ok: true;
      preview: CommandRulePreview;
    }
  | {
      ok: false;
      error: string;
      parsed: ParsedCommand;
    };

interface ResolvedTarget {
  selector: string;
  elements: HTMLElement[];
  label: string;
  confidence: number;
  reason: string;
}

interface TargetSpec {
  semanticSelectors: string[];
  attributeKeywords: string[];
  textKeywords: string[];
  plural?: boolean;
}

const AUTO_APPLY_CONFIDENCE = 0.56;
const MAX_ELEMENTS_TO_SCAN = 2500;

const TARGET_SPECS: Record<string, TargetSpec> = {
  sidebar: {
    semanticSelectors: ['aside', '[role="complementary"]'],
    attributeKeywords: ['sidebar', 'side-bar', 'side rail', 'rail'],
    textKeywords: ['sidebar']
  },
  ads: {
    semanticSelectors: [
      '[aria-label*="advertisement" i]',
      '[aria-label*="sponsored" i]',
      '[class*="advert" i]',
      '[id*="advert" i]',
      '[class*="sponsor" i]',
      '[id*="sponsor" i]',
      '[class*="promo" i]',
      '[id*="promo" i]',
      '[class*="ad-container" i]',
      '[id*="ad-container" i]',
      '[class*="ads" i]',
      '[id*="ads" i]'
    ],
    attributeKeywords: ['advert', 'advertisement', 'sponsor', 'sponsored', 'promo', 'ad-container', 'ads'],
    textKeywords: ['advertisement', 'sponsored'],
    plural: true
  },
  distractions: {
    semanticSelectors: [
      '[aria-label*="advertisement" i]',
      '[aria-label*="sponsored" i]',
      '[class*="advert" i]',
      '[id*="advert" i]',
      '[class*="sponsor" i]',
      '[id*="sponsor" i]',
      '[class*="promo" i]',
      '[id*="promo" i]',
      '[class*="newsletter" i]',
      '[id*="newsletter" i]',
      '[class*="subscribe" i]',
      '[id*="subscribe" i]',
      '[class*="cookie" i]',
      '[id*="cookie" i]',
      'dialog',
      '[role="dialog"]',
      '[aria-modal="true"]',
      'aside',
      '[role="complementary"]'
    ],
    attributeKeywords: [
      'advert',
      'sponsor',
      'promo',
      'newsletter',
      'subscribe',
      'cookie',
      'modal',
      'popup',
      'sidebar'
    ],
    textKeywords: ['advertisement', 'sponsored', 'subscribe', 'newsletter'],
    plural: true
  },
  popup: {
    semanticSelectors: [
      'dialog',
      '[role="dialog"]',
      '[aria-modal="true"]',
      '[class*="modal" i]',
      '[id*="modal" i]',
      '[class*="popup" i]',
      '[id*="popup" i]',
      '[class*="cookie" i]',
      '[id*="cookie" i]',
      '[class*="newsletter" i]',
      '[id*="newsletter" i]',
      '[class*="subscribe" i]',
      '[id*="subscribe" i]'
    ],
    attributeKeywords: ['popup', 'modal', 'dialog', 'overlay', 'cookie', 'newsletter', 'subscribe'],
    textKeywords: ['subscribe', 'newsletter', 'cookie', 'accept'],
    plural: true
  },
  header: {
    semanticSelectors: ['header', '[role="banner"]'],
    attributeKeywords: ['header', 'topbar', 'top-bar', 'masthead'],
    textKeywords: ['header']
  },
  heading: {
    semanticSelectors: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', '[role="heading"]'],
    attributeKeywords: ['heading', 'headline', 'title'],
    textKeywords: ['heading', 'title']
  },
  'main button': {
    semanticSelectors: [
      'main button',
      'main [role="button"]',
      'main input[type="button"]',
      'main input[type="submit"]',
      'button',
      '[role="button"]',
      'input[type="button"]',
      'input[type="submit"]'
    ],
    attributeKeywords: ['primary', 'main', 'cta', 'submit', 'save', 'continue', 'start', 'button'],
    textKeywords: ['submit', 'save', 'continue', 'start', 'get started']
  },
  buttons: {
    semanticSelectors: ['button', '[role="button"]', 'input[type="button"]', 'input[type="submit"]'],
    attributeKeywords: ['button', 'btn', 'cta'],
    textKeywords: ['button'],
    plural: true
  },
  nav: {
    semanticSelectors: ['nav', '[role="navigation"]'],
    attributeKeywords: ['nav', 'navigation', 'menu'],
    textKeywords: ['menu', 'navigation']
  },
  footer: {
    semanticSelectors: ['footer', '[role="contentinfo"]'],
    attributeKeywords: ['footer', 'bottom'],
    textKeywords: ['footer']
  }
};

export function createCommandRulePreview(
  command: string,
  domain: string,
  selectedElement: HTMLElement | null
): CommandResolution {
  const parsed = parseCommand(command);

  if (parsed.intent === 'unknown') {
    return {
      ok: false,
      parsed,
      error: parsed.reason ?? 'Command was unclear.'
    };
  }

  const preview =
    parsed.intent === 'preset'
      ? createPresetPreview(command, domain, parsed)
      : createSingleRulePreview(command, domain, parsed, selectedElement);

  return {
    ok: true,
    preview
  };
}

export function createCommandRulePreviewForElement(
  command: string,
  domain: string,
  parsed: ParsedCommand,
  element: HTMLElement,
  provider: CommandRulePreview['provider'] = 'local'
): CommandRulePreview {
  const fallbackParsed =
    parsed.intent === 'preset'
      ? {
          ...parsed,
          intent: 'hide' as const,
          targetDescription: parsed.targetDescription || 'selected element',
          reason: 'Manual element pick for preset command.'
        }
      : parsed;

  const rule = createRuleFromSelector(fallbackParsed, domain, generateSelector(element));
  const confidence = Math.min(0.95, Math.max(0.7, parsed.confidence));

  return buildPreview({
    command,
    parsed,
    rules: rule
      ? [
          {
            rule,
            targetLabel: describeElement(element),
            matchCount: 1,
            confidence,
            reason: 'User manually picked this element.'
          }
        ]
      : [],
    confidence,
    summary: summarizeParsed(parsed),
    needsElementPick: false,
    provider
  });
}

function createSingleRulePreview(
  command: string,
  domain: string,
  parsed: ParsedCommand,
  selectedElement: HTMLElement | null
): CommandRulePreview {
  if (parsed.preferSelected && isVisibleTarget(selectedElement)) {
    return createCommandRulePreviewForElement(command, domain, parsed, selectedElement);
  }

  const resolved = resolveTarget(parsed.targetDescription);
  if (!resolved) {
    return buildPickPreview(command, parsed, 'No matching visible element was found.');
  }

  const rule = createRuleFromSelector(parsed, domain, resolved.selector);
  if (!rule) {
    return buildPreview({
      command,
      parsed,
      rules: [],
      confidence: 0,
      summary: summarizeParsed(parsed),
      lowConfidenceReason: 'The command is missing a value needed to create a rule.'
    });
  }

  const confidence = combineConfidence(parsed.confidence, resolved.confidence);
  return buildPreview({
    command,
    parsed,
    rules: [
      {
        rule,
        targetLabel: resolved.label,
        matchCount: resolved.elements.length,
        confidence,
        reason: resolved.reason
      }
    ],
    confidence,
    summary: summarizeParsed(parsed),
    needsElementPick: confidence < AUTO_APPLY_CONFIDENCE,
    lowConfidenceReason:
      confidence < AUTO_APPLY_CONFIDENCE
        ? 'The target match is low confidence. Click the element you want this command to apply to.'
        : undefined
  });
}

function createPresetPreview(command: string, domain: string, parsed: ParsedCommand): CommandRulePreview {
  const targets = getPresetTargets(parsed);
  const items: CommandRulePreviewItem[] = [];
  const seenSelectors = new Set<string>();

  for (const target of targets) {
    const resolved = resolveTarget(target);
    if (!resolved || seenSelectors.has(resolved.selector)) {
      continue;
    }

    seenSelectors.add(resolved.selector);
    items.push({
      rule: createHideRule(domain, resolved.selector),
      targetLabel: resolved.label,
      matchCount: resolved.elements.length,
      confidence: combineConfidence(parsed.confidence, resolved.confidence),
      reason: resolved.reason
    });
  }

  if (items.length === 0) {
    return buildPickPreview(command, parsed, 'No distraction-like elements were found automatically.');
  }

  const confidence = average(items.map((item) => item.confidence));
  return buildPreview({
    command,
    parsed,
    rules: items,
    confidence,
    summary: summarizeParsed(parsed),
    needsElementPick: confidence < AUTO_APPLY_CONFIDENCE,
    lowConfidenceReason:
      confidence < AUTO_APPLY_CONFIDENCE
        ? 'The preset matched only low-confidence elements. Click a target manually.'
        : undefined
  });
}

function resolveTarget(targetDescription: string): ResolvedTarget | null {
  if (targetDescription === 'page' || targetDescription === 'text') {
    return {
      selector: 'body',
      elements: [document.body],
      label: targetDescription === 'page' ? 'page background' : 'page text',
      confidence: 0.82,
      reason: 'Resolved to the document body.'
    };
  }

  const spec = TARGET_SPECS[targetDescription] ?? createFallbackSpec(targetDescription);
  const semanticMatches = getVisibleMatches(spec.semanticSelectors);

  if (semanticMatches.length > 0) {
    return buildResolvedTarget(targetDescription, spec, semanticMatches, 'semantic');
  }

  const attributeMatches = scanVisibleElements((element) =>
    spec.attributeKeywords.some((keyword) => getAttributeHaystack(element).includes(keyword))
  );

  if (attributeMatches.length > 0) {
    return buildResolvedTarget(targetDescription, spec, attributeMatches, 'attribute');
  }

  const textMatches = scanVisibleElements((element) =>
    spec.textKeywords.some((keyword) => getElementHaystack(element).includes(keyword))
  );

  if (textMatches.length > 0) {
    return buildResolvedTarget(targetDescription, spec, textMatches, 'text');
  }

  return null;
}

function buildResolvedTarget(
  targetDescription: string,
  spec: TargetSpec,
  matches: HTMLElement[],
  source: 'semantic' | 'attribute' | 'text'
): ResolvedTarget {
  const visibleMatches = uniqueElements(matches).filter(isVisibleTarget);
  const plural = Boolean(spec.plural || targetDescription.endsWith('s'));

  if (plural && visibleMatches.length > 1) {
    return {
      selector: getGroupSelector(targetDescription, spec, visibleMatches),
      elements: visibleMatches,
      label: `${targetDescription} (${visibleMatches.length} matches)`,
      confidence: sourceConfidence(source, targetDescription, visibleMatches[0]),
      reason: `Matched ${visibleMatches.length} visible elements by ${source}.`
    };
  }

  const best = chooseBestCandidate(visibleMatches, targetDescription);
  return {
    selector: generateSelector(best),
    elements: [best],
    label: describeElement(best),
    confidence: sourceConfidence(source, targetDescription, best),
    reason: `Matched a visible element by ${source}.`
  };
}

function createRuleFromSelector(parsed: ParsedCommand, domain: string, selector: string): UIRule | null {
  switch (parsed.intent) {
    case 'hide':
      return createHideRule(domain, selector);
    case 'text':
      return parsed.value ? createTextRule(domain, selector, parsed.value) : null;
    case 'style':
      return parsed.styles ? createStyleRule(domain, selector, parsed.styles as UIStyleDeclaration) : null;
    case 'preset':
      return createHideRule(domain, selector);
    case 'unknown':
      return null;
  }
}

function buildPickPreview(command: string, parsed: ParsedCommand, reason: string): CommandRulePreview {
  return buildPreview({
    command,
    parsed,
    rules: [],
    confidence: Math.min(parsed.confidence, 0.45),
    summary: summarizeParsed(parsed),
    needsElementPick: true,
    lowConfidenceReason: `${reason} Click the element you want this command to apply to.`
  });
}

function buildPreview(input: {
  command: string;
  parsed: ParsedCommand;
  rules: CommandRulePreviewItem[];
  confidence: number;
  summary: string;
  needsElementPick?: boolean;
  lowConfidenceReason?: string;
  provider?: CommandRulePreview['provider'];
}): CommandRulePreview {
  return {
    command: input.command,
    provider: input.provider ?? 'local',
    parsed: input.parsed,
    summary: input.summary,
    confidence: clampConfidence(input.confidence),
    canApply:
      input.rules.length > 0 &&
      input.confidence >= AUTO_APPLY_CONFIDENCE &&
      input.needsElementPick !== true,
    rules: input.needsElementPick ? [] : input.rules,
    needsElementPick: input.needsElementPick,
    lowConfidenceReason: input.lowConfidenceReason
  };
}

function getPresetTargets(parsed: ParsedCommand): string[] {
  switch (parsed.preset) {
    case 'focus-mode':
      return ['ads', 'popup', 'sidebar', 'nav', 'footer'];
    case 'clean-page':
      return ['ads', 'popup', 'sidebar', 'footer'];
    case 'remove-distractions':
    default:
      return ['ads', 'popup', 'distractions', 'sidebar'];
  }
}

function getVisibleMatches(selectors: string[]): HTMLElement[] {
  return uniqueElements(selectors.flatMap(querySelectorAll)).filter(isVisibleTarget);
}

function querySelectorAll(selector: string): HTMLElement[] {
  try {
    return [...document.querySelectorAll<HTMLElement>(selector)];
  } catch {
    return [];
  }
}

function scanVisibleElements(predicate: (element: HTMLElement) => boolean): HTMLElement[] {
  const elements = [...document.body.querySelectorAll<HTMLElement>('*')].slice(0, MAX_ELEMENTS_TO_SCAN);
  return elements.filter((element) => isVisibleTarget(element) && predicate(element));
}

function chooseBestCandidate(elements: HTMLElement[], targetDescription: string): HTMLElement {
  return [...elements].sort(
    (left, right) => scoreElement(right, targetDescription) - scoreElement(left, targetDescription)
  )[0];
}

function scoreElement(element: HTMLElement, targetDescription: string): number {
  const tag = element.tagName.toLowerCase();
  const haystack = getElementHaystack(element);
  const rect = element.getBoundingClientRect();
  const area = rect.width * rect.height;
  let score = 0;

  if (targetDescription === 'heading' && /^h[1-6]$/.test(tag)) {
    score += 35;
  }

  if (targetDescription.includes('button') && isButtonLike(element)) {
    score += 32;
  }

  if (targetDescription === 'main button') {
    if (element.closest('main')) {
      score += 18;
    }

    if (['primary', 'main', 'cta', 'submit', 'save', 'continue', 'start'].some((word) => haystack.includes(word))) {
      score += 18;
    }
  }

  if (targetDescription === 'sidebar' && (tag === 'aside' || rect.width < window.innerWidth * 0.45)) {
    score += 22;
  }

  if (haystack.includes(targetDescription)) {
    score += 16;
  }

  if (area > 0 && area < window.innerWidth * window.innerHeight * 0.85) {
    score += Math.min(12, area / 10000);
  }

  return score;
}

function sourceConfidence(source: 'semantic' | 'attribute' | 'text', targetDescription: string, element: HTMLElement): number {
  const score = scoreElement(element, targetDescription);
  const sourceBase = source === 'semantic' ? 0.78 : source === 'attribute' ? 0.68 : 0.58;
  return clampConfidence(sourceBase + Math.min(score, 40) / 200);
}

function getGroupSelector(targetDescription: string, spec: TargetSpec, matches: HTMLElement[]): string {
  if (spec.semanticSelectors.length > 0 && getVisibleMatches(spec.semanticSelectors).length > 0) {
    return spec.semanticSelectors.join(', ');
  }

  if (targetDescription === 'buttons') {
    return 'button, [role="button"], input[type="button"], input[type="submit"]';
  }

  return matches.slice(0, 4).map(generateSelector).join(', ');
}

function createFallbackSpec(targetDescription: string): TargetSpec {
  const words = targetDescription.split(' ').filter((word) => word.length >= 3);
  return {
    semanticSelectors: [],
    attributeKeywords: words,
    textKeywords: words
  };
}

function summarizeParsed(parsed: ParsedCommand): string {
  switch (parsed.intent) {
    case 'hide':
      return `Hide ${parsed.targetDescription}.`;
    case 'text':
      return `Change ${parsed.targetDescription} text to "${parsed.value ?? ''}".`;
    case 'style':
      return `Style ${parsed.targetDescription}: ${Object.entries(parsed.styles ?? {})
        .map(([key, value]) => `${key} ${value}`)
        .join(', ')}.`;
    case 'preset':
      return `Apply preset: ${parsed.targetDescription}.`;
    case 'unknown':
      return parsed.reason ?? 'Unknown command.';
  }
}

function describeElement(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  const label =
    element.getAttribute('aria-label') ||
    element.getAttribute('data-testid') ||
    element.id ||
    element.textContent?.trim().slice(0, 48);

  return label ? `${tag}: ${label}` : tag;
}

function isButtonLike(element: HTMLElement): boolean {
  const tag = element.tagName.toLowerCase();
  return tag === 'button' || element.getAttribute('role') === 'button' || tag === 'input';
}

function isVisibleTarget(element: HTMLElement | null): element is HTMLElement {
  if (!element || !element.isConnected) {
    return false;
  }

  if (element === document.body || element === document.documentElement) {
    return false;
  }

  if (element.closest('[data-ui-remix-root="true"]')) {
    return false;
  }

  const rect = element.getBoundingClientRect();
  const styles = window.getComputedStyle(element);
  return (
    rect.width > 4 &&
    rect.height > 4 &&
    styles.display !== 'none' &&
    styles.visibility !== 'hidden' &&
    Number(styles.opacity) !== 0
  );
}

function getAttributeHaystack(element: HTMLElement): string {
  return [
    element.id,
    element.className,
    element.getAttribute('aria-label'),
    element.getAttribute('data-testid'),
    element.getAttribute('data-test'),
    element.getAttribute('role')
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();
}

function getElementHaystack(element: HTMLElement): string {
  return `${getAttributeHaystack(element)} ${element.textContent?.slice(0, 180) ?? ''}`.toLowerCase();
}

function uniqueElements(elements: HTMLElement[]): HTMLElement[] {
  return [...new Set(elements)];
}

function combineConfidence(parsedConfidence: number, targetConfidence: number): number {
  return clampConfidence(parsedConfidence * 0.48 + targetConfidence * 0.52);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}
