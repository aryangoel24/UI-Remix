import type { UIStyleDeclaration } from '../shared/types';

interface EditorOverlayCallbacks {
  onHide: () => void;
  onChangeText: () => void;
  onResize: () => void;
  onStyleSubmit: (styles: UIStyleDeclaration) => void;
  onCancel: () => void;
}

const OVERLAY_HOST_ID = 'ui-remix-editor-root';
const MENU_WIDTH = 260;
const VIEWPORT_MARGIN = 10;

export class EditorOverlay {
  private host: HTMLDivElement;
  private shadow: ShadowRoot;
  private hoverBox: HTMLDivElement;
  private selectedBox: HTMLDivElement;
  private menu: HTMLDivElement;
  private hoverElement: HTMLElement | null = null;
  private selectedElement: HTMLElement | null = null;

  constructor(private callbacks: EditorOverlayCallbacks) {
    this.host = document.createElement('div');
    this.host.id = OVERLAY_HOST_ID;
    this.host.dataset.uiRemixRoot = 'true';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    this.shadow.innerHTML = overlayMarkup();

    const hoverBox = this.shadow.querySelector<HTMLDivElement>('[data-hover-box]');
    const selectedBox = this.shadow.querySelector<HTMLDivElement>('[data-selected-box]');
    const menu = this.shadow.querySelector<HTMLDivElement>('[data-menu]');

    if (!hoverBox || !selectedBox || !menu) {
      throw new Error('UI Remix overlay failed to initialize.');
    }

    this.hoverBox = hoverBox;
    this.selectedBox = selectedBox;
    this.menu = menu;
    this.bindViewportUpdates();
  }

  mount(): void {
    if (!this.host.isConnected) {
      document.documentElement.appendChild(this.host);
    }
  }

  destroy(): void {
    this.host.remove();
    window.removeEventListener('scroll', this.syncPositions, true);
    window.removeEventListener('resize', this.syncPositions);
  }

  isOverlayEvent(event: Event): boolean {
    return event.composedPath().includes(this.host);
  }

  showHover(element: HTMLElement | null): void {
    this.hoverElement = element;
    this.positionBox(this.hoverBox, element);
  }

  select(element: HTMLElement): void {
    this.selectedElement = element;
    this.positionBox(this.selectedBox, element);
    this.renderActionMenu();
  }

  clearSelection(): void {
    this.selectedElement = null;
    this.selectedBox.hidden = true;
    this.menu.hidden = true;
    this.menu.replaceChildren();
  }

  showStyleEditor(element: HTMLElement): void {
    this.selectedElement = element;
    this.positionBox(this.selectedBox, element);
    this.renderStyleForm(element);
  }

  private bindViewportUpdates(): void {
    window.addEventListener('scroll', this.syncPositions, true);
    window.addEventListener('resize', this.syncPositions);
  }

  private syncPositions = (): void => {
    this.positionBox(this.hoverBox, this.hoverElement);
    this.positionBox(this.selectedBox, this.selectedElement);
    if (this.selectedElement && !this.menu.hidden) {
      this.positionMenu(this.selectedElement.getBoundingClientRect());
    }
  };

  private renderActionMenu(): void {
    if (!this.selectedElement) {
      this.clearSelection();
      return;
    }

    this.menu.innerHTML = `
      <div class="menu-title">UI Remix</div>
      <div class="button-grid">
        <button type="button" data-action="hide">Hide</button>
        <button type="button" data-action="text">Change Text</button>
        <button type="button" data-action="style">Style</button>
        <button type="button" data-action="resize">Resize</button>
      </div>
      <button type="button" class="secondary" data-action="cancel">Cancel</button>
    `;

    this.menu.querySelector('[data-action="hide"]')?.addEventListener('click', this.callbacks.onHide);
    this.menu
      .querySelector('[data-action="text"]')
      ?.addEventListener('click', this.callbacks.onChangeText);
    this.menu
      .querySelector('[data-action="style"]')
      ?.addEventListener('click', () => {
        if (this.selectedElement) {
          this.showStyleEditor(this.selectedElement);
        }
      });
    this.menu
      .querySelector('[data-action="resize"]')
      ?.addEventListener('click', this.callbacks.onResize);
    this.menu
      .querySelector('[data-action="cancel"]')
      ?.addEventListener('click', this.callbacks.onCancel);

    this.menu.hidden = false;
    this.positionMenu(this.selectedElement.getBoundingClientRect());
  }

  private renderStyleForm(element: HTMLElement): void {
    const styles = window.getComputedStyle(element);
    this.menu.innerHTML = `
      <form class="style-form">
        <div class="menu-title">Basic style</div>
        <label>
          <span>Background</span>
          <input name="backgroundColor" type="text" placeholder="#f6d365" value="${escapeHtml(
            normalizeTransparent(styles.backgroundColor)
          )}" />
        </label>
        <label>
          <span>Text color</span>
          <input name="color" type="text" placeholder="#111827" value="${escapeHtml(styles.color)}" />
        </label>
        <label>
          <span>Font size</span>
          <input name="fontSize" type="text" placeholder="18px" value="${escapeHtml(styles.fontSize)}" />
        </label>
        <label>
          <span>Radius</span>
          <input name="borderRadius" type="text" placeholder="8px" value="${escapeHtml(
            styles.borderRadius
          )}" />
        </label>
        <label>
          <span>Padding</span>
          <input name="padding" type="text" placeholder="12px 16px" value="${escapeHtml(styles.padding)}" />
        </label>
        <div class="form-actions">
          <button type="submit">Apply</button>
          <button type="button" class="secondary" data-action="cancel">Cancel</button>
        </div>
      </form>
    `;

    const form = this.menu.querySelector<HTMLFormElement>('form');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      this.callbacks.onStyleSubmit({
        backgroundColor: stringValue(formData.get('backgroundColor')),
        color: stringValue(formData.get('color')),
        fontSize: stringValue(formData.get('fontSize')),
        borderRadius: stringValue(formData.get('borderRadius')),
        padding: stringValue(formData.get('padding'))
      });
    });

    this.menu
      .querySelector('[data-action="cancel"]')
      ?.addEventListener('click', this.callbacks.onCancel);

    this.menu.hidden = false;
    this.positionMenu(element.getBoundingClientRect());
  }

  private positionBox(box: HTMLDivElement, element: HTMLElement | null): void {
    if (!element?.isConnected) {
      box.hidden = true;
      return;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      box.hidden = true;
      return;
    }

    box.hidden = false;
    box.style.transform = `translate(${Math.max(0, rect.left)}px, ${Math.max(0, rect.top)}px)`;
    box.style.width = `${rect.width}px`;
    box.style.height = `${rect.height}px`;
  }

  private positionMenu(rect: DOMRect): void {
    const left = clamp(rect.left, VIEWPORT_MARGIN, window.innerWidth - MENU_WIDTH - VIEWPORT_MARGIN);
    const belowTop = rect.bottom + 8;
    const aboveTop = rect.top - this.menu.offsetHeight - 8;
    const top =
      belowTop + this.menu.offsetHeight < window.innerHeight
        ? belowTop
        : Math.max(VIEWPORT_MARGIN, aboveTop);

    this.menu.style.transform = `translate(${left}px, ${top}px)`;
  }
}

function overlayMarkup(): string {
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

      .box {
        position: fixed;
        top: 0;
        left: 0;
        box-sizing: border-box;
        pointer-events: none;
        border-radius: 4px;
      }

      .hover {
        border: 2px dashed #00a7c8;
        background: rgba(0, 167, 200, 0.08);
      }

      .selected {
        border: 2px solid #ec4899;
        box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.18);
      }

      .menu {
        position: fixed;
        top: 0;
        left: 0;
        width: ${MENU_WIDTH}px;
        box-sizing: border-box;
        padding: 10px;
        pointer-events: auto;
        color: #171717;
        background: rgba(255, 255, 255, 0.98);
        border: 1px solid rgba(23, 23, 23, 0.18);
        border-radius: 8px;
        box-shadow: 0 18px 45px rgba(0, 0, 0, 0.22);
        backdrop-filter: blur(14px);
      }

      .menu-title {
        margin: 0 0 8px;
        font-size: 12px;
        font-weight: 750;
        letter-spacing: 0;
        color: #525252;
        text-transform: uppercase;
      }

      .button-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      button {
        appearance: none;
        min-height: 34px;
        border: 1px solid #171717;
        border-radius: 6px;
        background: #171717;
        color: #fff;
        font: inherit;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
      }

      button:hover {
        background: #2f2f2f;
      }

      button.secondary {
        width: 100%;
        margin-top: 8px;
        color: #171717;
        background: #f5f5f5;
        border-color: #d4d4d4;
      }

      button.secondary:hover {
        background: #e5e5e5;
      }

      .style-form {
        display: grid;
        gap: 8px;
      }

      label {
        display: grid;
        grid-template-columns: 84px 1fr;
        align-items: center;
        gap: 8px;
        font-size: 12px;
        font-weight: 650;
      }

      input {
        box-sizing: border-box;
        width: 100%;
        min-height: 32px;
        border: 1px solid #d4d4d4;
        border-radius: 6px;
        padding: 6px 8px;
        background: #fff;
        color: #171717;
        font: inherit;
        font-size: 12px;
      }

      .form-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 8px;
      }

      .form-actions .secondary {
        margin-top: 0;
      }
    </style>
    <div class="box hover" data-hover-box hidden></div>
    <div class="box selected" data-selected-box hidden></div>
    <div class="menu" data-menu hidden></div>
  `;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

function stringValue(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeTransparent(value: string): string {
  return value === 'rgba(0, 0, 0, 0)' ? '' : value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
