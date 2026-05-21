import type { AISettings, UIRule } from './types';

const RULES_STORAGE_KEY = 'uiRemix.rules.v1';
const AI_SETTINGS_STORAGE_KEY = 'uiRemix.aiSettings.v1';
const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: true,
  accessToken: ''
};

type ChromeStorageArea = typeof chrome.storage.local;

function getStorage(): ChromeStorageArea {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) {
    throw new Error('chrome.storage.local is unavailable in this context.');
  }

  return chrome.storage.local;
}

function chromeLastError(): Error | null {
  const message = chrome.runtime?.lastError?.message;
  return message ? new Error(message) : null;
}

function readStorage<T>(key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    getStorage().get(key, (result) => {
      const error = chromeLastError();
      if (error) {
        reject(error);
        return;
      }

      resolve(result[key] as T | undefined);
    });
  });
}

function writeStorage<T>(key: string, value: T): Promise<void> {
  return new Promise((resolve, reject) => {
    getStorage().set({ [key]: value }, () => {
      const error = chromeLastError();
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function normalizeRules(value: unknown): UIRule[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter(isPlausibleRule).map((rule) => ({
    ...rule,
    enabled: rule.enabled !== false
  }));
}

function isPlausibleRule(rule: unknown): rule is UIRule {
  if (!rule || typeof rule !== 'object') {
    return false;
  }

  const candidate = rule as Partial<UIRule>;
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.domain === 'string' &&
    typeof candidate.selector === 'string' &&
    typeof candidate.createdAt === 'string' &&
    ['hide', 'text', 'style', 'inject'].includes(String(candidate.type))
  );
}

export async function getAllRules(): Promise<UIRule[]> {
  const stored = await readStorage<unknown>(RULES_STORAGE_KEY);
  return normalizeRules(stored);
}

export async function getRulesForDomain(domain: string): Promise<UIRule[]> {
  const rules = await getAllRules();
  return rules.filter((rule) => rule.domain === domain);
}

export async function saveRule(rule: UIRule): Promise<void> {
  const rules = await getAllRules();
  const withoutDuplicate = rules.filter((existing) => existing.id !== rule.id);
  await writeStorage(RULES_STORAGE_KEY, [...withoutDuplicate, { ...rule, enabled: rule.enabled !== false }]);
}

export async function setRuleEnabled(ruleId: string, enabled: boolean): Promise<void> {
  const rules = await getAllRules();
  await writeStorage(
    RULES_STORAGE_KEY,
    rules.map((rule) => (rule.id === ruleId ? { ...rule, enabled } : rule))
  );
}

export async function deleteRule(ruleId: string): Promise<void> {
  const rules = await getAllRules();
  await writeStorage(
    RULES_STORAGE_KEY,
    rules.filter((rule) => rule.id !== ruleId)
  );
}

export async function clearRulesForDomain(domain: string): Promise<void> {
  const rules = await getAllRules();
  await writeStorage(
    RULES_STORAGE_KEY,
    rules.filter((rule) => rule.domain !== domain)
  );
}

export async function getAISettings(): Promise<AISettings> {
  const stored = await readStorage<Partial<AISettings>>(AI_SETTINGS_STORAGE_KEY);
  return normalizeAISettings(stored);
}

export async function saveAISettings(settings: AISettings): Promise<void> {
  await writeStorage(AI_SETTINGS_STORAGE_KEY, normalizeAISettings(settings));
}

function normalizeAISettings(value: unknown): AISettings {
  if (!value || typeof value !== 'object') {
    return DEFAULT_AI_SETTINGS;
  }

  const candidate = value as Partial<AISettings>;
  return {
    enabled: candidate.enabled !== false,
    accessToken: typeof candidate.accessToken === 'string' ? candidate.accessToken.trim() : ''
  };
}
