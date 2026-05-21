import assert from 'node:assert/strict';
import { parseCommand } from './commandParser';
import type { ParsedCommand } from './types';

interface ParserCase {
  name: string;
  command: string;
  expected: Partial<ParsedCommand>;
  minConfidence?: number;
}

const parserCases: ParserCase[] = [
  {
    name: 'hide sidebar',
    command: 'hide the sidebar',
    expected: {
      intent: 'hide',
      targetDescription: 'sidebar'
    },
    minConfidence: 0.8
  },
  {
    name: 'remove sidebar synonym',
    command: 'remove the sidebar',
    expected: {
      intent: 'hide',
      targetDescription: 'sidebar'
    },
    minConfidence: 0.8
  },
  {
    name: 'get rid of sidebar synonym',
    command: 'get rid of the sidebar',
    expected: {
      intent: 'hide',
      targetDescription: 'sidebar'
    },
    minConfidence: 0.8
  },
  {
    name: 'hide ads',
    command: 'hide ads',
    expected: {
      intent: 'hide',
      targetDescription: 'ads'
    },
    minConfidence: 0.8
  },
  {
    name: 'remove advertisements',
    command: 'remove advertisements',
    expected: {
      intent: 'hide',
      targetDescription: 'ads'
    },
    minConfidence: 0.8
  },
  {
    name: 'hide popups',
    command: 'hide popups',
    expected: {
      intent: 'hide',
      targetDescription: 'popup'
    },
    minConfidence: 0.8
  },
  {
    name: 'remove distractions preset',
    command: 'remove distractions',
    expected: {
      intent: 'preset',
      targetDescription: 'distractions',
      preset: 'remove-distractions'
    },
    minConfidence: 0.85
  },
  {
    name: 'focus mode preset',
    command: 'focus mode',
    expected: {
      intent: 'preset',
      targetDescription: 'focus mode',
      preset: 'focus-mode'
    },
    minConfidence: 0.9
  },
  {
    name: 'clean page preset',
    command: 'clean up this page',
    expected: {
      intent: 'preset',
      targetDescription: 'clean page',
      preset: 'clean-page'
    },
    minConfidence: 0.75
  },
  {
    name: 'cleaner page preset',
    command: 'make this page cleaner',
    expected: {
      intent: 'preset',
      targetDescription: 'clean page',
      preset: 'clean-page'
    },
    minConfidence: 0.75
  },
  {
    name: 'make buttons bigger',
    command: 'make buttons bigger',
    expected: {
      intent: 'style',
      targetDescription: 'buttons',
      styles: {
        fontSize: '1.15em',
        padding: '0.85em 1.25em',
        borderRadius: '10px'
      }
    },
    minConfidence: 0.75
  },
  {
    name: 'make main button larger',
    command: 'make the main button larger',
    expected: {
      intent: 'style',
      targetDescription: 'main button',
      styles: {
        fontSize: '1.15em',
        padding: '0.85em 1.25em',
        borderRadius: '10px'
      }
    },
    minConfidence: 0.75
  },
  {
    name: 'increase heading size',
    command: 'increase the heading size',
    expected: {
      intent: 'style',
      targetDescription: 'heading',
      styles: {
        fontSize: '1.2em'
      }
    },
    minConfidence: 0.75
  },
  {
    name: 'make text bigger',
    command: 'make text bigger',
    expected: {
      intent: 'style',
      targetDescription: 'text',
      styles: {
        fontSize: '1.2em'
      }
    },
    minConfidence: 0.75
  },
  {
    name: 'make background blue',
    command: 'make the background blue',
    expected: {
      intent: 'style',
      targetDescription: 'page',
      styles: {
        backgroundColor: 'blue'
      }
    },
    minConfidence: 0.75
  },
  {
    name: 'make text red',
    command: 'make text red',
    expected: {
      intent: 'style',
      targetDescription: 'text',
      styles: {
        color: 'red'
      }
    },
    minConfidence: 0.75
  },
  {
    name: 'change title text',
    command: 'change the title to My Dashboard',
    expected: {
      intent: 'text',
      targetDescription: 'heading',
      value: 'My Dashboard'
    },
    minConfidence: 0.85
  },
  {
    name: 'rename this heading text',
    command: 'rename this heading to My Dashboard',
    expected: {
      intent: 'text',
      targetDescription: 'heading',
      value: 'My Dashboard',
      preferSelected: true
    },
    minConfidence: 0.85
  },
  {
    name: 'unknown command',
    command: 'do something beautiful',
    expected: {
      intent: 'unknown',
      targetDescription: 'unknown'
    },
    minConfidence: 0
  }
];

for (const testCase of parserCases) {
  const parsed = parseCommand(testCase.command);

  for (const [key, expectedValue] of Object.entries(testCase.expected)) {
    assert.deepEqual(
      parsed[key as keyof ParsedCommand],
      expectedValue,
      `${testCase.name}: expected ${key} to match`
    );
  }

  if (testCase.minConfidence !== undefined) {
    assert.ok(
      parsed.confidence >= testCase.minConfidence,
      `${testCase.name}: expected confidence ${parsed.confidence} to be >= ${testCase.minConfidence}`
    );
  }
}

console.log(`commandParser: ${parserCases.length} cases passed`);
