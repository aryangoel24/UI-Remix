import type { HideRule, StyleRule, TextRule, UIStyleDeclaration } from './types';

const DEFAULT_PATH_PATTERN = '*';

export function createRuleId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createHideRule(domain: string, selector: string): HideRule {
  return {
    id: createRuleId(),
    domain,
    pathPattern: DEFAULT_PATH_PATTERN,
    type: 'hide',
    selector,
    createdAt: new Date().toISOString()
  };
}

export function createTextRule(domain: string, selector: string, value: string): TextRule {
  return {
    id: createRuleId(),
    domain,
    pathPattern: DEFAULT_PATH_PATTERN,
    type: 'text',
    selector,
    value,
    createdAt: new Date().toISOString()
  };
}

export function createStyleRule(
  domain: string,
  selector: string,
  styles: UIStyleDeclaration
): StyleRule {
  return {
    id: createRuleId(),
    domain,
    pathPattern: DEFAULT_PATH_PATTERN,
    type: 'style',
    selector,
    styles,
    createdAt: new Date().toISOString()
  };
}
