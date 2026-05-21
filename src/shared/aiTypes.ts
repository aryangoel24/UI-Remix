import type { ParsedCommand, UIStyleDeclaration } from './types';

export interface PageCandidate {
  id: string;
  selector: string;
  tag: string;
  text: string;
  role: string | null;
  ariaLabel: string | null;
  title: string | null;
  name: string | null;
  testId: string | null;
  elementId: string | null;
  className: string | null;
  parentTag: string | null;
  parentRole: string | null;
  parentAriaLabel: string | null;
  parentClassName: string | null;
  parentText: string | null;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface AICommandInterpretRequest {
  command: string;
  url: string;
  domain: string;
  title: string;
  selectedCandidateId: string | null;
  candidates: PageCandidate[];
}

export interface AICommandInterpretResult {
  parsed: ParsedCommand;
  targetCandidateIds: string[];
}

export interface RawAICommandResult {
  intent: ParsedCommand['intent'];
  targetCandidateIds: string[];
  targetDescription: string;
  value: string;
  styles: Required<Record<keyof UIStyleDeclaration, string>>;
  preset: 'remove-distractions' | 'focus-mode' | 'clean-page' | 'none';
  confidence: number;
  reason: string;
}

export type BackgroundAIMessage = {
  type: 'UI_REMIX_AI_INTERPRET_COMMAND';
  request: AICommandInterpretRequest;
};

export interface BackgroundAIResponse {
  ok: boolean;
  result?: AICommandInterpretResult;
  error?: string;
}
