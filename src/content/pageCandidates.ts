import { generateSelector } from '../shared/selector';
import type { PageCandidate } from '../shared/aiTypes';

const MAX_CANDIDATES = 120;
const CANDIDATE_SELECTOR = [
  'body',
  'main',
  'header',
  'footer',
  'nav',
  'aside',
  'section',
  'article',
  'button',
  'a',
  'input',
  'textarea',
  'select',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ytd-button-renderer',
  'ytd-toggle-button-renderer',
  'tp-yt-paper-button',
  '[role]',
  '[aria-label]',
  '[title]',
  '[data-testid]',
  '[data-test]',
  '[class*="sidebar" i]',
  '[class*="modal" i]',
  '[class*="popup" i]',
  '[class*="advert" i]',
  '[class*="promo" i]',
  '[class*="button" i]',
  '[class*="action" i]',
  '[class*="primary" i]',
  '[id*="sidebar" i]',
  '[id*="modal" i]',
  '[id*="popup" i]',
  '[id*="advert" i]',
  '[id*="promo" i]',
  '[id*="action" i]',
  '[id*="primary" i]'
].join(', ');

export function collectPageCandidates(selectedElement: HTMLElement | null): PageCandidate[] {
  const candidates: PageCandidate[] = [];
  const seen = new Set<HTMLElement>();

  if (document.body) {
    addCandidate(candidates, seen, document.body, 'candidate-page');
  }

  if (selectedElement?.isConnected) {
    addCandidate(candidates, seen, selectedElement, 'candidate-selected');
  }

  const elements = [...document.querySelectorAll<HTMLElement>(CANDIDATE_SELECTOR)]
    .filter(isVisibleCandidate)
    .sort((left, right) => scoreCandidateElement(right) - scoreCandidateElement(left));

  for (const element of elements) {
    if (candidates.length >= MAX_CANDIDATES) {
      break;
    }

    addCandidate(candidates, seen, element, `candidate-${candidates.length + 1}`);
  }

  return candidates;
}

function addCandidate(
  candidates: PageCandidate[],
  seen: Set<HTMLElement>,
  element: HTMLElement,
  id: string
): void {
  if (seen.has(element) || !isVisibleCandidate(element)) {
    return;
  }

  seen.add(element);
  const rect = element.getBoundingClientRect();
  const parent = element.parentElement;

  try {
    candidates.push({
      id,
      selector: generateSelector(element),
      tag: element.tagName.toLowerCase(),
      text: normalizeText(element.textContent ?? '').slice(0, 160),
      role: element.getAttribute('role'),
      ariaLabel: element.getAttribute('aria-label'),
      title: element.getAttribute('title'),
      name: element.getAttribute('name'),
      testId: element.getAttribute('data-testid') ?? element.getAttribute('data-test'),
      elementId: element.id || null,
      className: typeof element.className === 'string' ? element.className.slice(0, 160) || null : null,
      parentTag: parent?.tagName.toLowerCase() ?? null,
      parentRole: parent?.getAttribute('role') ?? null,
      parentAriaLabel: parent?.getAttribute('aria-label') ?? null,
      parentClassName:
        parent && typeof parent.className === 'string' ? parent.className.slice(0, 160) || null : null,
      parentText: parent ? normalizeText(parent.textContent ?? '').slice(0, 160) || null : null,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    });
  } catch {
    // Ignore elements that cannot produce a selector.
  }
}

function isVisibleCandidate(element: HTMLElement): boolean {
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

function scoreCandidateElement(element: HTMLElement): number {
  const tag = element.tagName.toLowerCase();
  const rect = element.getBoundingClientRect();
  const haystack = [
    tag,
    element.id,
    element.className,
    element.getAttribute('role'),
    element.getAttribute('aria-label'),
    element.getAttribute('title'),
    element.getAttribute('data-testid'),
    element.getAttribute('data-test'),
    element.textContent?.slice(0, 120)
  ]
    .filter((value): value is string => typeof value === 'string')
    .join(' ')
    .toLowerCase();

  let score = 0;

  if (['main', 'header', 'footer', 'nav', 'aside', 'button'].includes(tag)) {
    score += 24;
  }

  if (/^h[1-6]$/.test(tag)) {
    score += 22;
  }

  if (element.getAttribute('role')) {
    score += 10;
  }

  if (element.getAttribute('aria-label')) {
    score += 10;
  }

  if (/(sidebar|advert|ad-|promo|modal|popup|button|primary|cta|action|heading|title|nav|footer)/.test(haystack)) {
    score += 18;
  }

  const area = rect.width * rect.height;
  if (area > 0 && area < window.innerWidth * window.innerHeight * 0.9) {
    score += Math.min(14, area / 12000);
  }

  return score;
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
