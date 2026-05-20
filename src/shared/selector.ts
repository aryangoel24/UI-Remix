const DATA_ATTRIBUTES = ['data-testid', 'data-test', 'data-qa', 'data-cy'];
const MAX_CLASS_TOKENS = 3;

export function generateSelector(element: HTMLElement): string {
  const ownerDocument = element.ownerDocument;
  const tagName = element.tagName.toLowerCase();

  if (element.id && isStableToken(element.id)) {
    const selector = `#${escapeCssIdentifier(element.id)}`;
    if (isSelectorUnique(selector, ownerDocument)) {
      return selector;
    }
  }

  for (const attribute of DATA_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (!value) {
      continue;
    }

    const selector = `${tagName}[${attribute}="${escapeCssString(value)}"]`;
    if (isSelectorUnique(selector, ownerDocument)) {
      return selector;
    }
  }

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    const selector = `${tagName}[aria-label="${escapeCssString(ariaLabel)}"]`;
    if (isSelectorUnique(selector, ownerDocument)) {
      return selector;
    }
  }

  const role = element.getAttribute('role');
  if (role) {
    const roleSelector = `${tagName}[role="${escapeCssString(role)}"]`;
    if (isSelectorUnique(roleSelector, ownerDocument)) {
      return roleSelector;
    }

    if (ariaLabel) {
      const combinedSelector = `${roleSelector}[aria-label="${escapeCssString(ariaLabel)}"]`;
      if (isSelectorUnique(combinedSelector, ownerDocument)) {
        return combinedSelector;
      }
    }
  }

  const classSelector = createClassSelector(element);
  if (classSelector && isSelectorUnique(classSelector, ownerDocument)) {
    return classSelector;
  }

  const attributeWithAncestor = createAncestorSelector(element);
  if (attributeWithAncestor) {
    return attributeWithAncestor;
  }

  return createDomPathSelector(element);
}

export function isSelectorUnique(selector: string, root: ParentNode = document): boolean {
  try {
    return root.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function createClassSelector(element: HTMLElement): string | null {
  const classTokens = [...element.classList].filter(isStableClassToken).slice(0, MAX_CLASS_TOKENS);
  if (classTokens.length === 0) {
    return null;
  }

  const tagName = element.tagName.toLowerCase();
  return `${tagName}${classTokens.map((className) => `.${escapeCssIdentifier(className)}`).join('')}`;
}

function createAncestorSelector(element: HTMLElement): string | null {
  const ownerDocument = element.ownerDocument;
  const ownSelector = createClassSelector(element) ?? element.tagName.toLowerCase();
  const ancestors: HTMLElement[] = [];
  let current = element.parentElement;

  while (current && current !== ownerDocument.body && ancestors.length < 4) {
    ancestors.push(current);
    current = current.parentElement;
  }

  for (const ancestor of ancestors) {
    const anchor = createAnchorSelector(ancestor);
    if (!anchor) {
      continue;
    }

    const selector = `${anchor} ${ownSelector}`;
    if (isSelectorUnique(selector, ownerDocument)) {
      return selector;
    }
  }

  return null;
}

function createAnchorSelector(element: HTMLElement): string | null {
  const tagName = element.tagName.toLowerCase();

  if (element.id && isStableToken(element.id)) {
    return `#${escapeCssIdentifier(element.id)}`;
  }

  for (const attribute of DATA_ATTRIBUTES) {
    const value = element.getAttribute(attribute);
    if (value) {
      return `${tagName}[${attribute}="${escapeCssString(value)}"]`;
    }
  }

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) {
    return `${tagName}[aria-label="${escapeCssString(ariaLabel)}"]`;
  }

  return createClassSelector(element);
}

function createDomPathSelector(element: HTMLElement): string {
  const segments: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current.nodeType === Node.ELEMENT_NODE) {
    const tagName = current.tagName.toLowerCase();
    if (tagName === 'html') {
      segments.unshift('html');
      break;
    }

    let segment = tagName;
    const parent: HTMLElement | null = current.parentElement;

    if (parent) {
      const sameTagSiblings = [...parent.children].filter(
        (child) => child.tagName.toLowerCase() === tagName
      );

      if (sameTagSiblings.length > 1) {
        const index = sameTagSiblings.indexOf(current) + 1;
        segment = `${segment}:nth-of-type(${index})`;
      }
    }

    segments.unshift(segment);
    current = parent;
  }

  return segments.join(' > ');
}

function isStableToken(token: string): boolean {
  const trimmed = token.trim();
  if (trimmed.length < 2 || trimmed.length > 80) {
    return false;
  }

  if (/^[a-f0-9]{8,}$/i.test(trimmed)) {
    return false;
  }

  if (/[0-9]{5,}/.test(trimmed)) {
    return false;
  }

  if (/^(ember|react|radix|headlessui|mui|chakra)-?\d+$/i.test(trimmed)) {
    return false;
  }

  return /^[a-zA-Z][\w:-]*$/.test(trimmed);
}

function isStableClassToken(token: string): boolean {
  if (!isStableToken(token)) {
    return false;
  }

  if (/^css-[a-z0-9]+$/i.test(token)) {
    return false;
  }

  if (/^_[a-z0-9]+$/i.test(token)) {
    return false;
  }

  return true;
}

function escapeCssIdentifier(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
    return CSS.escape(value);
  }

  return value.replace(/[^a-zA-Z0-9_-]/g, (character) => `\\${character}`);
}

function escapeCssString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
