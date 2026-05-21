import type { PageCandidate } from '../shared/aiTypes';
import type { ParsedCommand } from '../shared/types';

interface ScoredCandidate {
  candidate: PageCandidate;
  score: number;
  reason: string;
}

export interface AITargetResolution {
  candidates: PageCandidate[];
  confidence: number;
  reason: string;
}

const MAX_TARGETS = 6;
const MIN_TARGET_SCORE = 0.54;
const BUTTON_TERMS = [
  'button',
  'btn',
  'action',
  'cta',
  'primary',
  'submit',
  'save',
  'share',
  'download',
  'like',
  'dislike',
  'subscribe',
  'join',
  'ask',
  'buy',
  'checkout',
  'cart',
  'continue',
  'start',
  'apply',
  'send',
  'confirm'
];
const DISTRACTION_TERMS = [
  'ad',
  'ads',
  'advert',
  'advertisement',
  'sponsor',
  'promo',
  'promoted',
  'recommend',
  'suggested',
  'related',
  'sidebar',
  'popup',
  'modal',
  'overlay'
];

export function resolveAITargetCandidates(
  command: string,
  parsed: ParsedCommand,
  candidates: PageCandidate[]
): AITargetResolution | null {
  const intentText = normalize(`${command} ${parsed.targetDescription} ${parsed.reason ?? ''}`);

  if (isPageTarget(intentText, parsed)) {
    const page = candidates.find((candidate) => candidate.id === 'candidate-page' || candidate.tag === 'body');
    if (page) {
      return {
        candidates: [page],
        confidence: 0.82,
        reason: 'Resolved the command to the page-level candidate.'
      };
    }
  }

  const resolution =
    resolveSpecificTarget(intentText, candidates) ??
    resolveHeadingTarget(intentText, candidates) ??
    resolveButtonTarget(intentText, candidates) ??
    resolveGenericTarget(intentText, parsed, candidates);

  return resolution;
}

export function estimateModelTargetConfidence(candidates: PageCandidate[]): number {
  if (candidates.length === 0) {
    return 0;
  }

  const scored = candidates.map((candidate) => scoreGenericCandidate(candidate, candidateHaystack(candidate)));
  return clampConfidence(Math.max(0.62, average(scored.map((item) => item.score))));
}

function resolveSpecificTarget(intentText: string, candidates: PageCandidate[]): AITargetResolution | null {
  const targetSpecs: Array<{
    key: RegExp;
    keywords: string[];
    plural: boolean;
    label: string;
  }> = [
    {
      key: /\b(sidebar|side bar|rail|aside|recommendations?)\b/,
      keywords: ['sidebar', 'side bar', 'aside', 'rail', 'recommend', 'suggested', 'related'],
      plural: false,
      label: 'sidebar-like elements'
    },
    {
      key: /\b(ads?|adverts?|advertisements?|sponsors?|promos?|distractions?)\b/,
      keywords: DISTRACTION_TERMS,
      plural: true,
      label: 'distraction-like elements'
    },
    {
      key: /\b(popups?|pop ups?|modals?|overlays?)\b/,
      keywords: ['popup', 'pop up', 'modal', 'overlay', 'dialog'],
      plural: true,
      label: 'popup-like elements'
    },
    {
      key: /\b(headers?|top bar|masthead)\b/,
      keywords: ['header', 'top bar', 'masthead', 'banner'],
      plural: false,
      label: 'header'
    },
    {
      key: /\b(nav|navigation|menu)\b/,
      keywords: ['nav', 'navigation', 'menu'],
      plural: false,
      label: 'navigation'
    },
    {
      key: /\b(footers?)\b/,
      keywords: ['footer'],
      plural: false,
      label: 'footer'
    }
  ];

  const spec = targetSpecs.find((item) => item.key.test(intentText));
  if (!spec) {
    return null;
  }

  const scored = candidates
    .filter((candidate) => candidate.id !== 'candidate-page')
    .map((candidate) => {
      const haystack = candidateHaystack(candidate);
      let score = keywordScore(haystack, spec.keywords, 0.42);

      if (spec.keywords.includes(candidate.tag)) {
        score += 0.28;
      }

      if (candidate.role && spec.keywords.some((keyword) => normalize(candidate.role ?? '').includes(keyword))) {
        score += 0.18;
      }

      if (spec.key.test(normalize(candidate.tag))) {
        score += 0.28;
      }

      if (spec.label.includes('distraction') && scoreCandidateAsDistraction(candidate) > score) {
        score = scoreCandidateAsDistraction(candidate);
      }

      return {
        candidate,
        score: clampConfidence(score),
        reason: `Matched ${spec.label} from page metadata.`
      };
    });

  return createResolution(scored, spec.plural, spec.label);
}

function resolveHeadingTarget(intentText: string, candidates: PageCandidate[]): AITargetResolution | null {
  if (!/\b(headings?|titles?|headline)\b/.test(intentText)) {
    return null;
  }

  const scored = candidates.map((candidate) => {
    const haystack = candidateHaystack(candidate);
    let score = 0;

    if (/^h[1-6]$/.test(candidate.tag)) {
      score += candidate.tag === 'h1' ? 0.74 : 0.64;
    }

    score += keywordScore(haystack, ['heading', 'title', 'headline'], 0.28);

    if (candidate.rect.y >= 0 && candidate.rect.y < viewportHeight() * 0.55) {
      score += 0.08;
    }

    if (candidate.rect.width > 120 && candidate.rect.height < 120) {
      score += 0.06;
    }

    return {
      candidate,
      score: clampConfidence(score),
      reason: 'Matched a heading/title-like element.'
    };
  });

  return createResolution(scored, /\b(headings|titles)\b/.test(intentText), 'heading/title elements');
}

function resolveButtonTarget(intentText: string, candidates: PageCandidate[]): AITargetResolution | null {
  if (!/\b(buttons?|actions?|cta|primary|important|stand out)\b/.test(intentText)) {
    return null;
  }

  const plural = /\b(buttons|actions)\b/.test(intentText);
  const scored = candidates.map((candidate) => scoreButtonCandidate(candidate, intentText));

  return createResolution(scored, plural, plural ? 'action buttons' : 'primary action');
}

function resolveGenericTarget(
  intentText: string,
  parsed: ParsedCommand,
  candidates: PageCandidate[]
): AITargetResolution | null {
  const tokens = tokenize(`${intentText} ${parsed.targetDescription}`)
    .filter((token) => token.length > 2)
    .filter((token) => !COMMON_WORDS.has(token));

  if (tokens.length === 0) {
    return null;
  }

  const scored = candidates
    .filter((candidate) => candidate.id !== 'candidate-page')
    .map((candidate) => scoreGenericCandidate(candidate, candidateHaystack(candidate), tokens));

  return createResolution(scored, /\b(all|every|items|elements|buttons|ads|distractions)\b/.test(intentText), 'matching elements');
}

function scoreButtonCandidate(candidate: PageCandidate, intentText: string): ScoredCandidate {
  const haystack = candidateHaystack(candidate);
  const label = candidateLabel(candidate);
  let score = 0;

  if (isButtonLike(candidate)) {
    score += 0.46;
  }

  score += keywordScore(haystack, BUTTON_TERMS, 0.26);

  const requestedTerms = BUTTON_TERMS.filter((term) => intentText.includes(term));
  if (requestedTerms.length > 0) {
    score += keywordScore(haystack, requestedTerms, 0.2);
  }

  if (/\b(main|primary|important|stand out)\b/.test(intentText)) {
    score += keywordScore(haystack, ['primary', 'main', 'cta', 'subscribe', 'join', 'share', 'save', 'download', 'like'], 0.18);

    if (isInMainContentArea(candidate)) {
      score += 0.08;
    }

    if (isLikelyHeaderCandidate(candidate)) {
      score -= 0.12;
    }

    if (isLikelySidebarCandidate(candidate)) {
      score -= 0.14;
    }
  }

  if (label && label.length <= 80 && candidate.rect.width >= 20 && candidate.rect.height >= 20) {
    score += 0.06;
  }

  return {
    candidate,
    score: clampConfidence(score),
    reason: 'Matched a button/action-like element.'
  };
}

function scoreGenericCandidate(
  candidate: PageCandidate,
  haystack: string,
  tokens: string[] = []
): ScoredCandidate {
  let score = 0;

  score += keywordScore(haystack, tokens, 0.5);

  if (candidate.ariaLabel || candidate.title || candidate.testId || candidate.elementId) {
    score += 0.1;
  }

  if (candidate.tag !== 'body' && candidate.rect.width > 20 && candidate.rect.height > 20) {
    score += 0.08;
  }

  return {
    candidate,
    score: clampConfidence(score),
    reason: 'Matched target words in page metadata.'
  };
}

function scoreCandidateAsDistraction(candidate: PageCandidate): number {
  const haystack = candidateHaystack(candidate);
  let score = keywordScore(haystack, DISTRACTION_TERMS, 0.54);

  if (isLikelySidebarCandidate(candidate)) {
    score += 0.16;
  }

  if (candidate.tag === 'aside') {
    score += 0.2;
  }

  return clampConfidence(score);
}

function createResolution(
  scored: ScoredCandidate[],
  plural: boolean,
  label: string
): AITargetResolution | null {
  const matches = dedupeCandidates(
    scored
      .filter((item) => item.score >= MIN_TARGET_SCORE)
      .sort((left, right) => right.score - left.score)
      .map((item) => item)
  );

  if (matches.length === 0) {
    return null;
  }

  const selected = plural ? matches.slice(0, MAX_TARGETS) : matches.slice(0, 1);
  const confidence = clampConfidence(average(selected.map((item) => item.score)));

  return {
    candidates: selected.map((item) => item.candidate),
    confidence,
    reason: `Auto-selected ${selected.length} ${label} by intent.`
  };
}

function dedupeCandidates(candidates: ScoredCandidate[]): ScoredCandidate[] {
  const seen = new Set<string>();
  const deduped: ScoredCandidate[] = [];

  for (const item of candidates) {
    const key = [
      normalize(candidateLabel(item.candidate)).slice(0, 80),
      item.candidate.tag,
      Math.round(item.candidate.rect.x / 8),
      Math.round(item.candidate.rect.y / 8)
    ].join('|');

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}

function isPageTarget(intentText: string, parsed: ParsedCommand): boolean {
  const hasNarrowTarget = /\b(button|buttons|action|actions|heading|title|sidebar|ad|ads|popup|nav|footer)\b/.test(intentText);

  if (/\b(background|body)\b/.test(intentText)) {
    return true;
  }

  if (/\b(page|site|website)\b/.test(intentText) && !hasNarrowTarget) {
    return true;
  }

  if (/\b(text|font)\b/.test(intentText) && !hasNarrowTarget) {
    return true;
  }

  return parsed.intent === 'style' && Boolean(parsed.styles?.backgroundColor) && !hasNarrowTarget;
}

function isButtonLike(candidate: PageCandidate): boolean {
  const haystack = candidateHaystack(candidate);

  return (
    candidate.tag === 'button' ||
    candidate.tag === 'input' ||
    candidate.role === 'button' ||
    /\b(button|btn|cta|primary|submit|subscribe|share|save|download|like|join)\b/.test(haystack)
  );
}

function isInMainContentArea(candidate: PageCandidate): boolean {
  const width = viewportWidth();
  const height = viewportHeight();

  return candidate.rect.x >= 0 && candidate.rect.x < width * 0.78 && candidate.rect.y > height * 0.08;
}

function isLikelyHeaderCandidate(candidate: PageCandidate): boolean {
  const haystack = candidateHaystack(candidate);
  return candidate.rect.y < 120 || /\b(header|masthead|topbar|top bar|nav|navigation)\b/.test(haystack);
}

function isLikelySidebarCandidate(candidate: PageCandidate): boolean {
  const width = viewportWidth();
  const haystack = candidateHaystack(candidate);

  return (
    candidate.tag === 'aside' ||
    candidate.rect.x > width * 0.72 ||
    /\b(sidebar|aside|rail|recommend|suggested|related)\b/.test(haystack)
  );
}

function keywordScore(haystack: string, keywords: string[], maxScore: number): number {
  if (keywords.length === 0) {
    return 0;
  }

  const matched = keywords.filter((keyword) => haystack.includes(normalize(keyword))).length;
  if (matched === 0) {
    return 0;
  }

  return Math.min(maxScore, (matched / Math.min(keywords.length, 4)) * maxScore);
}

function candidateHaystack(candidate: PageCandidate): string {
  return normalize(
    [
      candidate.tag,
      candidate.role,
      candidate.ariaLabel,
      candidate.title,
      candidate.name,
      candidate.testId,
      candidate.elementId,
      candidate.className,
      candidate.text,
      candidate.parentTag,
      candidate.parentRole,
      candidate.parentAriaLabel,
      candidate.parentClassName,
      candidate.parentText
    ]
      .filter(Boolean)
      .join(' ')
  );
}

function candidateLabel(candidate: PageCandidate): string {
  return (
    candidate.ariaLabel ||
    candidate.title ||
    candidate.text ||
    candidate.name ||
    candidate.testId ||
    candidate.elementId ||
    candidate.className ||
    candidate.tag
  );
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(/\s+/)
    .filter(Boolean);
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
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

function viewportWidth(): number {
  return typeof window === 'undefined' ? 1440 : window.innerWidth;
}

function viewportHeight(): number {
  return typeof window === 'undefined' ? 900 : window.innerHeight;
}

const COMMON_WORDS = new Set([
  'the',
  'this',
  'that',
  'these',
  'those',
  'make',
  'change',
  'hide',
  'remove',
  'style',
  'bigger',
  'larger',
  'smaller',
  'main',
  'most',
  'important',
  'page',
  'site',
  'website',
  'element',
  'elements',
  'content',
  'with',
  'from',
  'into',
  'to',
  'on',
  'of',
  'and',
  'or'
]);
