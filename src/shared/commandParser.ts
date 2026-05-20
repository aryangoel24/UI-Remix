import type { ParsedCommand } from './types';

const COLOR_WORDS = new Set([
  'black',
  'blue',
  'green',
  'grey',
  'gray',
  'orange',
  'pink',
  'purple',
  'red',
  'white',
  'yellow'
]);

const HIDE_VERBS = ['hide', 'remove', 'delete', 'dismiss', 'clear'];
const BIGGER_WORDS = ['bigger', 'larger', 'increase', 'enlarge', 'grow', 'bolder'];
const TEXT_VERBS = ['rename', 'change', 'set', 'update'];

export function parseCommand(command: string): ParsedCommand {
  const original = command.trim();
  const normalized = normalizeCommand(original);

  if (!normalized) {
    return unknown('Type a command first.');
  }

  return (
    parsePresetCommand(normalized) ??
    parseTextCommand(original, normalized) ??
    parseHideCommand(normalized) ??
    parseStyleCommand(normalized) ??
    unknown('No supported intent matched this command.')
  );
}

function parsePresetCommand(normalized: string): ParsedCommand | null {
  if (
    /\bfocus mode\b/.test(normalized) ||
    /\breading mode\b/.test(normalized) ||
    /\bmake\b.+\bfocused\b/.test(normalized)
  ) {
    return {
      intent: 'preset',
      targetDescription: 'focus mode',
      preset: 'focus-mode',
      confidence: 0.92,
      reason: 'Matched a focus-mode preset phrase.'
    };
  }

  if (
    /\bremove\b.+\bdistractions?\b/.test(normalized) ||
    /\bhide\b.+\bdistractions?\b/.test(normalized) ||
    /\bget rid of\b.+\bdistractions?\b/.test(normalized)
  ) {
    return {
      intent: 'preset',
      targetDescription: 'distractions',
      preset: 'remove-distractions',
      confidence: 0.9,
      reason: 'Matched the remove-distractions preset.'
    };
  }

  if (
    /\bclean up\b/.test(normalized) ||
    /\bcleaner\b/.test(normalized) ||
    /\bdeclutter\b/.test(normalized)
  ) {
    return {
      intent: 'preset',
      targetDescription: 'clean page',
      preset: 'clean-page',
      confidence: 0.78,
      reason: 'Matched a clean-page preset phrase.'
    };
  }

  return null;
}

function parseTextCommand(original: string, normalized: string): ParsedCommand | null {
  if (!TEXT_VERBS.some((verb) => hasWord(normalized, verb))) {
    return null;
  }

  const textMatch = normalized.match(
    /^(?:rename|change|set|update)\s+(?:(?:the|this|a|an)\s+)?(.+?)\s+(?:to|as)\s+(.+)$/
  );
  if (!textMatch) {
    return null;
  }

  const rawTarget = textMatch[1];
  const value = extractOriginalValue(original);
  if (!value) {
    return null;
  }

  const targetDescription = normalizeTarget(rawTarget);
  const textSpecific = /\b(text|title|heading|label|copy)\b/.test(rawTarget);

  return {
    intent: 'text',
    targetDescription,
    value,
    confidence: textSpecific ? 0.9 : 0.76,
    preferSelected: /\bthis\b/.test(normalized),
    reason: 'Matched a text-change command.'
  };
}

function parseHideCommand(normalized: string): ParsedCommand | null {
  const getRidMatch = normalized.match(/^get rid of\s+(.+)$/);
  const verbMatch = normalized.match(/^(?:hide|remove|delete|dismiss|clear)\s+(.+)$/);
  const target = getRidMatch?.[1] ?? verbMatch?.[1];

  if (!target || !HIDE_VERBS.some((verb) => hasWord(normalized, verb)) && !normalized.startsWith('get rid of')) {
    return null;
  }

  const targetDescription = normalizeTarget(target);
  const confidence = targetDescription === 'unknown' ? 0.35 : knownTargetConfidence(targetDescription);

  return {
    intent: 'hide',
    targetDescription,
    confidence,
    preferSelected: /\bthis\b/.test(normalized),
    reason: normalized.startsWith('get rid of')
      ? 'Matched the get-rid-of hide synonym.'
      : 'Matched a hide/remove synonym.'
  };
}

function parseStyleCommand(normalized: string): ParsedCommand | null {
  const colorCommand = parseColorStyle(normalized);
  if (colorCommand) {
    return colorCommand;
  }

  const sizeCommand = parseSizeStyle(normalized);
  if (sizeCommand) {
    return sizeCommand;
  }

  return null;
}

function parseColorStyle(normalized: string): ParsedCommand | null {
  const words = normalized.split(' ');
  const color = words.find((word) => COLOR_WORDS.has(word));
  if (!color || !normalized.startsWith('make ')) {
    return null;
  }

  const beforeColor = normalized.slice('make '.length, normalized.lastIndexOf(color)).trim();
  const targetDescription = normalizeTarget(beforeColor || 'text');
  const property = /\b(background|page|screen)\b/.test(beforeColor) ? 'backgroundColor' : 'color';

  return {
    intent: 'style',
    targetDescription: property === 'backgroundColor' ? 'page' : targetDescription,
    styles: {
      [property]: color === 'grey' ? 'gray' : color
    },
    confidence: 0.8,
    preferSelected: /\bthis\b/.test(normalized),
    reason: 'Matched a simple color style command.'
  };
}

function parseSizeStyle(normalized: string): ParsedCommand | null {
  const hasSizeVerb = /\b(make|resize|increase|enlarge|grow)\b/.test(normalized);
  const hasBiggerWord = BIGGER_WORDS.some((word) => hasWord(normalized, word)) || /\bsize\b/.test(normalized);

  if (!hasSizeVerb || !hasBiggerWord) {
    return null;
  }

  const targetDescription = normalizeTarget(
    normalized
      .replace(/\b(make|resize|increase|enlarge|grow|the|this|a|an|size|font|text)\b/g, ' ')
      .replace(/\b(bigger|larger|increase|increased|enlarged|bolder)\b/g, ' ')
  );

  const target = targetDescription === 'unknown' ? inferSizeTarget(normalized) : targetDescription;
  const textLike = /\b(text|heading|title|font)\b/.test(normalized);

  return {
    intent: 'style',
    targetDescription: target,
    styles: textLike
      ? { fontSize: '1.2em' }
      : {
          fontSize: '1.15em',
          padding: '0.85em 1.25em',
          borderRadius: '10px'
        },
    confidence: target === 'unknown' ? 0.42 : 0.78,
    preferSelected: /\bthis\b/.test(normalized),
    reason: 'Matched a bigger/larger/increase style command.'
  };
}

function inferSizeTarget(normalized: string): string {
  if (/\bbuttons?\b/.test(normalized)) {
    return normalized.includes('main') ? 'main button' : 'buttons';
  }

  if (/\bheadings?\b|\btitle\b/.test(normalized)) {
    return 'heading';
  }

  if (/\btext\b|\bfont\b/.test(normalized)) {
    return 'text';
  }

  return 'unknown';
}

function normalizeTarget(value: string): string {
  const target = value
    .replace(/\b(the|a|an|please|this|that|my|page|site)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!target) {
    return 'unknown';
  }

  if (/\b(sidebar|side bar|aside)\b/.test(target)) {
    return 'sidebar';
  }

  if (/\b(ad|ads|advert|adverts|advertisement|advertisements|sponsor|sponsored|promo|promos)\b/.test(target)) {
    return 'ads';
  }

  if (/\b(distraction|distractions|clutter|noise)\b/.test(target)) {
    return 'distractions';
  }

  if (/\b(popup|popups|pop up|modal|dialog|overlay|cookie|newsletter|subscribe)\b/.test(target)) {
    return 'popup';
  }

  if (/\b(main button|primary button|cta)\b/.test(target)) {
    return 'main button';
  }

  if (/\b(button|buttons)\b/.test(target)) {
    return target.includes('main') || target.includes('primary') ? 'main button' : 'buttons';
  }

  if (/\b(heading|headings|title|headline|h1)\b/.test(target)) {
    return 'heading';
  }

  if (/\b(header|top bar|banner)\b/.test(target)) {
    return 'header';
  }

  if (/\b(nav|navigation|menu)\b/.test(target)) {
    return 'nav';
  }

  if (/\b(footer|bottom)\b/.test(target)) {
    return 'footer';
  }

  if (/\b(background|page|screen)\b/.test(target)) {
    return 'page';
  }

  if (/\b(text|font|copy|content)\b/.test(target)) {
    return 'text';
  }

  return target;
}

function knownTargetConfidence(targetDescription: string): number {
  return [
    'sidebar',
    'ads',
    'distractions',
    'popup',
    'main button',
    'buttons',
    'heading',
    'header',
    'nav',
    'footer',
    'page',
    'text'
  ].includes(targetDescription)
    ? 0.86
    : 0.58;
}

function unknown(reason: string): ParsedCommand {
  return {
    intent: 'unknown',
    targetDescription: 'unknown',
    confidence: 0,
    reason
  };
}

function extractOriginalValue(command: string): string | null {
  const match = command.match(/\s(?:to|as)\s(.+)$/i);
  return match?.[1]?.trim() || null;
}

function normalizeCommand(command: string): string {
  return command
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasWord(value: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`).test(value);
}
