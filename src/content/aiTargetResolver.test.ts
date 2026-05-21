import assert from 'node:assert/strict';
import { resolveAITargetCandidates } from './aiTargetResolver';
import type { PageCandidate } from '../shared/aiTypes';
import type { ParsedCommand } from '../shared/types';

function candidate(overrides: Partial<PageCandidate>): PageCandidate {
  return {
    id: 'candidate-test',
    selector: 'button',
    tag: 'button',
    text: '',
    role: null,
    ariaLabel: null,
    title: null,
    name: null,
    testId: null,
    elementId: null,
    className: null,
    parentTag: null,
    parentRole: null,
    parentAriaLabel: null,
    parentClassName: null,
    parentText: null,
    rect: {
      x: 120,
      y: 520,
      width: 96,
      height: 40
    },
    ...overrides
  };
}

const baseStyleParsed: ParsedCommand = {
  intent: 'style',
  targetDescription: 'The main action buttons on the YouTube video page.',
  styles: {
    backgroundColor: '#000000',
    color: '#ffffff'
  },
  confidence: 0.4,
  reason: 'The user asked for the important action to stand out.'
};

const actionCandidates = [
  candidate({
    id: 'candidate-page',
    selector: 'body',
    tag: 'body',
    text: 'Watch page',
    rect: { x: 0, y: 0, width: 1440, height: 900 }
  }),
  candidate({
    id: 'candidate-share',
    selector: 'button[aria-label="Share"]',
    ariaLabel: 'Share',
    text: 'Share'
  }),
  candidate({
    id: 'candidate-save',
    selector: 'button[aria-label="Save"]',
    ariaLabel: 'Save',
    text: 'Save'
  }),
  candidate({
    id: 'candidate-sidebar-video',
    selector: '.recommendation',
    tag: 'a',
    text: 'Recommended video',
    parentClassName: 'secondary related videos',
    rect: { x: 1120, y: 260, width: 260, height: 94 }
  })
];

const actionResolution = resolveAITargetCandidates(
  'make the most important action stand out',
  baseStyleParsed,
  actionCandidates
);

assert(actionResolution, 'expected action buttons to resolve automatically');
assert.equal(actionResolution.candidates.length, 2);
assert.deepEqual(
  actionResolution.candidates.map((item) => item.id),
  ['candidate-share', 'candidate-save']
);
assert(actionResolution.confidence >= 0.56);

const pageResolution = resolveAITargetCandidates(
  'make the background blue',
  {
    intent: 'style',
    targetDescription: 'page background',
    styles: {
      backgroundColor: 'blue'
    },
    confidence: 0.72
  },
  actionCandidates
);

assert(pageResolution, 'expected page background command to resolve to body');
assert.equal(pageResolution.candidates[0]?.id, 'candidate-page');

const headingResolution = resolveAITargetCandidates(
  'change the title to My Dashboard',
  {
    intent: 'text',
    targetDescription: 'title',
    value: 'My Dashboard',
    confidence: 0.74
  },
  [
    ...actionCandidates,
    candidate({
      id: 'candidate-heading',
      selector: 'h1',
      tag: 'h1',
      text: 'Existing Dashboard',
      rect: { x: 80, y: 180, width: 420, height: 56 }
    })
  ]
);

assert(headingResolution, 'expected heading command to resolve automatically');
assert.equal(headingResolution.candidates[0]?.id, 'candidate-heading');

console.log('aiTargetResolver: intent target cases passed');
