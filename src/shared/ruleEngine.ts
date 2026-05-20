import type { UIRule, UIStyleDeclaration } from './types';

interface AppliedRecord {
  element: HTMLElement;
  previousTextContent?: string | null;
  previousStyles: Record<string, { value: string; priority: string }>;
}

const appliedByRule = new Map<string, AppliedRecord[]>();

export function applyRule(rule: UIRule): void {
  if (!rule.selector) {
    console.warn('[UI Remix] Skipping rule with empty selector', rule);
    return;
  }

  const elements = findElements(rule.selector);
  if (elements.length === 0) {
    return;
  }

  for (const element of elements) {
    if (!(element instanceof HTMLElement)) {
      continue;
    }

    switch (rule.type) {
      case 'hide':
        applyHideRule(rule.id, element);
        break;
      case 'text':
        applyTextRule(rule.id, element, rule.value);
        break;
      case 'style':
        applyStyleRule(rule.id, element, rule.styles);
        break;
      case 'inject':
        console.info('[UI Remix] InjectRule is reserved for future support.', rule.id);
        break;
    }
  }
}

export function applyRules(rules: UIRule[]): void {
  const uniqueRules = dedupeRules(rules);

  for (const rule of uniqueRules) {
    applyRule(rule);
  }
}

export function removeRule(ruleId: string): void {
  const records = appliedByRule.get(ruleId);
  if (!records) {
    return;
  }

  for (const record of records) {
    if (!record.element.isConnected) {
      continue;
    }

    if (record.previousTextContent !== undefined) {
      record.element.textContent = record.previousTextContent;
    }

    for (const [property, previous] of Object.entries(record.previousStyles)) {
      if (previous.value) {
        record.element.style.setProperty(property, previous.value, previous.priority);
      } else {
        record.element.style.removeProperty(property);
      }
    }
  }

  appliedByRule.delete(ruleId);
}

function applyHideRule(ruleId: string, element: HTMLElement): void {
  const record = ensureRecord(ruleId, element, ['display']);
  element.style.setProperty('display', 'none', 'important');
  saveRecord(ruleId, record);
}

function applyTextRule(ruleId: string, element: HTMLElement, value: string): void {
  const record = ensureRecord(ruleId, element, []);
  if (record.previousTextContent === undefined) {
    record.previousTextContent = element.textContent;
  }

  element.textContent = value;
  saveRecord(ruleId, record);
}

function applyStyleRule(ruleId: string, element: HTMLElement, styles: UIStyleDeclaration): void {
  const cssProperties = Object.entries(styles).filter(([, value]) => Boolean(value));
  const record = ensureRecord(
    ruleId,
    element,
    cssProperties.map(([property]) => toKebabCase(property))
  );

  for (const [property, value] of cssProperties) {
    element.style.setProperty(toKebabCase(property), String(value), 'important');
  }

  saveRecord(ruleId, record);
}

function findElements(selector: string): Element[] {
  try {
    return [...document.querySelectorAll(selector)];
  } catch (error) {
    console.warn('[UI Remix] Invalid selector in saved rule', selector, error);
    return [];
  }
}

function ensureRecord(ruleId: string, element: HTMLElement, styleProperties: string[]): AppliedRecord {
  const existing = appliedByRule.get(ruleId)?.find((record) => record.element === element);
  if (existing) {
    return existing;
  }

  const previousStyles: AppliedRecord['previousStyles'] = {};
  for (const property of styleProperties) {
    previousStyles[property] = {
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property)
    };
  }

  return {
    element,
    previousStyles
  };
}

function saveRecord(ruleId: string, record: AppliedRecord): void {
  const existingRecords = appliedByRule.get(ruleId) ?? [];
  if (existingRecords.some((existing) => existing.element === record.element)) {
    return;
  }

  appliedByRule.set(ruleId, [...existingRecords, record]);
}

function dedupeRules(rules: UIRule[]): UIRule[] {
  const byId = new Map<string, UIRule>();

  for (const rule of rules) {
    byId.set(rule.id, rule);
  }

  return [...byId.values()];
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
