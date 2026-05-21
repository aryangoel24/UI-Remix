import { createHideRule, createStyleRule, createTextRule } from '../shared/ruleFactory';
import type { BackgroundAIMessage, BackgroundAIResponse, PageCandidate } from '../shared/aiTypes';
import type {
  CommandRulePreview,
  CommandRulePreviewItem,
  ParsedCommand,
  UIRule,
  UIStyleDeclaration
} from '../shared/types';
import { collectPageCandidates } from './pageCandidates';
import { estimateModelTargetConfidence, resolveAITargetCandidates } from './aiTargetResolver';

const AUTO_APPLY_CONFIDENCE = 0.56;
const STYLE_ALLOWLIST = new Set<keyof UIStyleDeclaration>([
  'backgroundColor',
  'color',
  'fontSize',
  'borderRadius',
  'padding',
  'width',
  'height'
]);

export async function createAICommandRulePreview(
  command: string,
  domain: string,
  selectedElement: HTMLElement | null
): Promise<CommandRulePreview | null> {
  const candidates = collectPageCandidates(selectedElement);
  const selectedCandidate = candidates.find((candidate) => candidate.id === 'candidate-selected');

  const response = await sendAIInterpretRequest({
    type: 'UI_REMIX_AI_INTERPRET_COMMAND',
    request: {
      command,
      url: window.location.href,
      domain,
      title: document.title,
      selectedCandidateId: selectedCandidate?.id ?? null,
      candidates
    }
  });

  if (!response.ok || !response.result) {
    console.info('[UI Remix] AI command interpretation unavailable.', response.error);
    return null;
  }

  if (response.result.parsed.intent === 'unknown') {
    return null;
  }

  return buildAIPreview(command, domain, response.result.parsed, response.result.targetCandidateIds, candidates);
}

function sendAIInterpretRequest(message: BackgroundAIMessage): Promise<BackgroundAIResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response: BackgroundAIResponse | undefined) => {
      const error = chrome.runtime.lastError;
      if (error) {
        resolve({ ok: false, error: error.message });
        return;
      }

      resolve(response ?? { ok: false, error: 'AI endpoint did not respond.' });
    });
  });
}

function buildAIPreview(
  command: string,
  domain: string,
  parsed: ParsedCommand,
  targetCandidateIds: string[],
  candidates: PageCandidate[]
): CommandRulePreview {
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const modelSelectedCandidates = targetCandidateIds
    .map((candidateId) => candidateById.get(candidateId))
    .filter((candidate): candidate is PageCandidate => Boolean(candidate));
  const intentResolution =
    modelSelectedCandidates.length > 0
      ? null
      : resolveAITargetCandidates(command, parsed, candidates);
  const selectedCandidates = modelSelectedCandidates.length > 0
    ? modelSelectedCandidates
    : intentResolution?.candidates ?? [];

  const targetConfidence =
    modelSelectedCandidates.length > 0
      ? estimateModelTargetConfidence(modelSelectedCandidates)
      : intentResolution?.confidence ?? 0;
  const confidence = combineAIConfidence(parsed.confidence, targetConfidence);
  const resolutionReason =
    modelSelectedCandidates.length > 0
      ? 'AI selected matching page candidates.'
      : intentResolution?.reason;
  const rules = selectedCandidates.flatMap((candidate) =>
    createRulesForCandidate(parsed, domain, candidate, confidence, resolutionReason)
  );
  const needsElementPick = rules.length === 0 || confidence < AUTO_APPLY_CONFIDENCE;

  return {
    command,
    provider: 'ai',
    parsed: {
      ...parsed,
      reason: parsed.reason ? `AI: ${parsed.reason}` : 'AI command interpretation.'
    },
    summary: summarizeAICommand(parsed),
    confidence,
    canApply: rules.length > 0 && !needsElementPick,
    rules: needsElementPick ? [] : rules,
    needsElementPick,
    lowConfidenceReason: needsElementPick
      ? 'AI understood the command, but no target was confident enough. Click the element you want this command to apply to.'
      : undefined
  };
}

function createRulesForCandidate(
  parsed: ParsedCommand,
  domain: string,
  candidate: PageCandidate,
  confidence: number,
  reason?: string
): CommandRulePreviewItem[] {
  const rule = createRule(parsed, domain, candidate.selector);
  if (!rule) {
    return [];
  }

  return [
    {
      rule,
      targetLabel: describeCandidate(candidate),
      matchCount: 1,
      confidence,
      reason: reason ?? parsed.reason
    }
  ];
}

function createRule(parsed: ParsedCommand, domain: string, selector: string): UIRule | null {
  switch (parsed.intent) {
    case 'hide':
    case 'preset':
      return markAISource(createHideRule(domain, selector));
    case 'text':
      return parsed.value ? markAISource(createTextRule(domain, selector, parsed.value)) : null;
    case 'style': {
      const styles = sanitizeStyles(parsed.styles ?? {});
      return Object.keys(styles).length > 0 ? markAISource(createStyleRule(domain, selector, styles)) : null;
    }
    case 'unknown':
      return null;
  }
}

function markAISource<T extends UIRule>(rule: T): T {
  return {
    ...rule,
    source: 'ai'
  };
}

function sanitizeStyles(styles: Record<string, string>): UIStyleDeclaration {
  const sanitized: UIStyleDeclaration = {};

  for (const [property, value] of Object.entries(styles)) {
    if (!STYLE_ALLOWLIST.has(property as keyof UIStyleDeclaration) || !value.trim()) {
      continue;
    }

    sanitized[property as keyof UIStyleDeclaration] = value.trim();
  }

  return sanitized;
}

function summarizeAICommand(parsed: ParsedCommand): string {
  switch (parsed.intent) {
    case 'hide':
      return `AI proposes hiding ${parsed.targetDescription}.`;
    case 'text':
      return `AI proposes changing ${parsed.targetDescription} text to "${parsed.value ?? ''}".`;
    case 'style':
      return `AI proposes styling ${parsed.targetDescription}.`;
    case 'preset':
      return `AI proposes applying ${parsed.targetDescription}.`;
    case 'unknown':
      return parsed.reason ?? 'AI could not interpret this command.';
  }
}

function describeCandidate(candidate: PageCandidate): string {
  const label = candidate.ariaLabel || candidate.text || candidate.elementId || candidate.className;
  return label ? `${candidate.tag}: ${label.slice(0, 56)}` : candidate.tag;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function combineAIConfidence(parsedConfidence: number, targetConfidence: number): number {
  if (targetConfidence <= 0) {
    return clampConfidence(parsedConfidence);
  }

  return clampConfidence(parsedConfidence * 0.35 + targetConfidence * 0.65);
}
