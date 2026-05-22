import http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash, timingSafeEqual } from 'node:crypto';
import type {
  AICommandInterpretRequest,
  AICommandInterpretResult,
  BackgroundAIResponse,
  RawAICommandResult,
  PageCandidate
} from '../src/shared/aiTypes';
import type { ParsedCommand, UIStyleDeclaration } from '../src/shared/types';
import { createUsageStore } from './usage-store';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1');
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_MODEL ?? 'gpt-5.4-nano';
const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const OPENAI_TIMEOUT_MS = Number(process.env.OPENAI_TIMEOUT_MS ?? 15000);
const MAX_REQUEST_BYTES = Number(process.env.MAX_REQUEST_BYTES ?? 180_000);
const MAX_CANDIDATES = Number(process.env.MAX_CANDIDATES ?? 120);
const MAX_COMMAND_LENGTH = Number(process.env.MAX_COMMAND_LENGTH ?? 500);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? 30);
const INVITE_TOKEN_HASHES = new Set([
  ...parseList(process.env.INVITE_TOKEN_HASHES ?? ''),
  ...parseList(process.env.INVITE_TOKENS ?? '').map(hashToken)
]);
const LOG_REQUESTS = process.env.LOG_REQUESTS !== 'false';
const ALLOWED_ORIGINS = parseAllowedOrigins(
  process.env.ALLOWED_ORIGINS ?? process.env.EXTENSION_ORIGIN ?? ''
);
const usageStore = createUsageStore();

const server = http.createServer(async (request, response) => {
  const startedAt = Date.now();
  if (!setCorsHeaders(request, response)) {
    logRequest(request, 403, startedAt);
    writeJson(response, 403, { ok: false, error: 'Origin is not allowed.' });
    return;
  }

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === 'GET' && request.url === '/health') {
    logRequest(request, 200, startedAt);
    writeJson(response, 200, {
      ok: true,
      model: OPENAI_MODEL,
      hasOpenAIKey: Boolean(OPENAI_API_KEY),
      inviteGateEnabled: INVITE_TOKEN_HASHES.size > 0,
      usageStore: usageStore.name
    });
    return;
  }

  if (request.method !== 'POST' || request.url !== '/api/interpret-command') {
    logRequest(request, 404, startedAt);
    writeJson(response, 404, { ok: false, error: 'Not found' });
    return;
  }

  const accessToken = getAccessToken(request);
  const accessTokenHash = accessToken ? hashToken(accessToken) : null;
  if (!isInviteTokenAllowed(accessTokenHash)) {
    logRequest(request, 401, startedAt, { access: accessTokenHash ? 'invalid-token' : 'missing-token' });
    await recordUsage({
      actorKey: getActorKey(request, accessTokenHash),
      status: 401
    });
    writeJson(response, 401, { ok: false, error: 'A valid UI Remix access token is required.' });
    return;
  }

  const actorKey = getActorKey(request, accessTokenHash);
  const rateLimit = await usageStore.checkRateLimit(
    actorKey,
    RATE_LIMIT_MAX_REQUESTS,
    RATE_LIMIT_WINDOW_MS
  );
  if (!rateLimit.allowed) {
    response.setHeader('retry-after', String(Math.ceil(rateLimit.retryAfterMs / 1000)));
    logRequest(request, 429, startedAt, { access: tokenLogId(accessTokenHash) });
    await recordUsage({
      actorKey,
      status: 429
    });
    writeJson(response, 429, {
      ok: false,
      error: 'Rate limit exceeded. Try again shortly.'
    } satisfies BackgroundAIResponse);
    return;
  }

  if (!OPENAI_API_KEY) {
    logRequest(request, 500, startedAt, { access: tokenLogId(accessTokenHash) });
    await recordUsage({
      actorKey,
      status: 500
    });
    writeJson(response, 500, {
      ok: false,
      error: 'OPENAI_API_KEY is not set.'
    } satisfies BackgroundAIResponse);
    return;
  }

  try {
    const body = await readJson<AICommandInterpretRequest>(request);
    validateRequest(body);
    const result = await interpretWithOpenAI(body);
    logRequest(request, 200, startedAt, {
      access: tokenLogId(accessTokenHash),
      domain: body.domain,
      commandLength: body.command.length,
      candidates: body.candidates.length,
      intent: result.parsed.intent,
      targets: result.targetCandidateIds.length
    });
    await recordUsage({
      actorKey,
      status: 200,
      intent: result.parsed.intent,
      candidates: body.candidates.length,
      targets: result.targetCandidateIds.length
    });
    writeJson(response, 200, { ok: true, result } satisfies BackgroundAIResponse);
  } catch (error) {
    logRequest(request, 400, startedAt, {
      access: tokenLogId(accessTokenHash),
      error: error instanceof Error ? error.message : String(error)
    });
    await recordUsage({
      actorKey,
      status: 400
    });
    writeJson(response, 400, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    } satisfies BackgroundAIResponse);
  }
});

server.listen(PORT, HOST, () => {
  console.info(`[UI Remix AI] listening on http://${HOST}:${PORT} with ${usageStore.name} usage store`);
});

async function interpretWithOpenAI(
  request: AICommandInterpretRequest
): Promise<AICommandInterpretResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_TIMEOUT_MS);

  try {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${OPENAI_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: buildSystemPrompt()
              }
            ]
          },
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: JSON.stringify(minimizeRequest(request))
              }
            ]
          }
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'ui_remix_command_interpretation',
            strict: true,
            schema: responseSchema
          }
        },
        max_output_tokens: 1600
      }),
      signal: controller.signal
    });

    const json = await response.json();
    if (!response.ok) {
      throw new Error(json?.error?.message ?? `OpenAI request failed with ${response.status}`);
    }

    const outputText = extractOutputText(json);
    if (!outputText) {
      throw new Error('OpenAI response did not include structured output text.');
    }

    return normalizeAIResult(JSON.parse(outputText) as RawAICommandResult, request.candidates);
  } finally {
    clearTimeout(timeout);
  }
}

function buildSystemPrompt(): string {
  return [
    'You convert user commands for a browser extension into safe UI editing intents.',
    'Return only the schema fields.',
    'Use only candidate IDs provided in the request. Never invent candidate IDs.',
    'Never generate JavaScript, HTML, network requests, or arbitrary CSS.',
    'Allowed intents: hide, style, text, preset, unknown.',
    'Allowed style properties: backgroundColor, color, fontSize, borderRadius, padding, width, height.',
    'Use preset only for remove-distractions, focus-mode, or clean-page style commands.',
    'When candidates clearly satisfy the intent, choose their targetCandidateIds even if the command is broad.',
    'Do not leave targetCandidateIds empty just because the target wording is approximate; infer from visible labels, roles, titles, ids, classes, text, and rectangles.',
    'For commands like "make the most important action stand out", infer likely primary/action buttons from candidates.',
    'If you choose targetCandidateIds, use confidence >= 0.62 unless the chosen target is genuinely uncertain.',
    'If the command or target is truly ambiguous, use confidence below 0.56 and explain why.',
    'For plural targets like ads, buttons, or distractions, return multiple relevant candidate IDs.',
    'Prefer selectedCandidateId when the command says this/selected/current element.'
  ].join('\n');
}

function normalizeAIResult(
  raw: RawAICommandResult,
  candidates: PageCandidate[]
): AICommandInterpretResult {
  const candidateIds = new Set(candidates.map((candidate) => candidate.id));
  const targetCandidateIds = raw.targetCandidateIds.filter((candidateId) => candidateIds.has(candidateId));
  const styles = normalizeStyles(raw.styles);
  const preset = raw.preset === 'none' ? undefined : raw.preset;
  const value = raw.value.trim() || undefined;

  const parsed: ParsedCommand = {
    intent: raw.intent,
    targetDescription: raw.targetDescription.trim() || 'unknown',
    value,
    styles: Object.keys(styles).length > 0 ? styles : undefined,
    confidence: clampConfidence(raw.confidence),
    reason: raw.reason.trim() || 'AI command interpretation.',
    preset
  };

  if (parsed.intent === 'unknown') {
    return {
      parsed,
      targetCandidateIds: []
    };
  }

  return {
    parsed,
    targetCandidateIds
  };
}

function normalizeStyles(styles: RawAICommandResult['styles']): Record<string, string> {
  const normalized: Record<keyof UIStyleDeclaration, string> = {
    backgroundColor: '',
    color: '',
    fontSize: '',
    borderRadius: '',
    padding: '',
    width: '',
    height: ''
  };

  for (const key of Object.keys(normalized) as Array<keyof UIStyleDeclaration>) {
    normalized[key] = String(styles[key] ?? '').trim();
  }

  return Object.fromEntries(Object.entries(normalized).filter(([, value]) => value));
}

function minimizeRequest(request: AICommandInterpretRequest): AICommandInterpretRequest {
  return {
    ...request,
    command: request.command.slice(0, MAX_COMMAND_LENGTH),
    candidates: request.candidates.slice(0, MAX_CANDIDATES).map((candidate) => ({
      ...candidate,
      text: candidate.text.slice(0, 120),
      className: candidate.className?.slice(0, 100) ?? null,
      parentText: candidate.parentText?.slice(0, 100) ?? null,
      parentClassName: candidate.parentClassName?.slice(0, 100) ?? null
    }))
  };
}

function validateRequest(request: AICommandInterpretRequest): void {
  if (!request || typeof request !== 'object') {
    throw new Error('Invalid request body.');
  }

  if (typeof request.command !== 'string' || !request.command.trim()) {
    throw new Error('Command is required.');
  }

  if (request.command.length > MAX_COMMAND_LENGTH) {
    throw new Error(`Command must be ${MAX_COMMAND_LENGTH} characters or less.`);
  }

  if (!Array.isArray(request.candidates)) {
    throw new Error('Candidates are required.');
  }

  if (request.candidates.length > MAX_CANDIDATES) {
    throw new Error(`Too many candidates. Maximum is ${MAX_CANDIDATES}.`);
  }

  for (const candidate of request.candidates) {
    validateCandidate(candidate);
  }
}

function extractOutputText(response: unknown): string | null {
  const outputText = (response as { output_text?: unknown }).output_text;
  if (typeof outputText === 'string') {
    return outputText;
  }

  const output = (response as { output?: unknown }).output;
  if (!Array.isArray(output)) {
    return null;
  }

  for (const item of output) {
    const content = (item as { content?: unknown }).content;
    if (!Array.isArray(content)) {
      continue;
    }

    for (const contentItem of content) {
      const text = (contentItem as { text?: unknown }).text;
      if (typeof text === 'string') {
        return text;
      }
    }
  }

  return null;
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;

    if (totalBytes > MAX_REQUEST_BYTES) {
      throw new Error(`Request body exceeds ${MAX_REQUEST_BYTES} bytes.`);
    }

    chunks.push(buffer);
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function setCorsHeaders(request: IncomingMessage, response: ServerResponse): boolean {
  const origin = request.headers.origin;
  response.setHeader('vary', 'origin');
  response.setHeader('access-control-allow-methods', 'POST, OPTIONS');
  response.setHeader('access-control-allow-headers', 'content-type, x-ui-remix-access-token');

  if (!origin) {
    return true;
  }

  if (!isOriginAllowed(origin)) {
    return false;
  }

  response.setHeader('access-control-allow-origin', origin);
  return true;
}

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    'content-type': 'application/json',
    'cache-control': 'no-store'
  });
  response.end(JSON.stringify(body));
}

function validateCandidate(candidate: PageCandidate): void {
  if (!candidate || typeof candidate !== 'object') {
    throw new Error('Invalid candidate.');
  }

  if (
    typeof candidate.id !== 'string' ||
    typeof candidate.selector !== 'string' ||
    typeof candidate.tag !== 'string' ||
    !candidate.id ||
    !candidate.selector ||
    !candidate.tag
  ) {
    throw new Error('Candidate is missing required fields.');
  }

  if (typeof candidate.text !== 'string' || candidate.text.length > 1_000) {
    throw new Error('Candidate text is too large.');
  }

  if (!candidate.rect || typeof candidate.rect.width !== 'number' || typeof candidate.rect.height !== 'number') {
    throw new Error('Candidate rectangle is invalid.');
  }
}

function parseAllowedOrigins(value: string): string[] {
  return parseList(value);
}

function isOriginAllowed(origin: string): boolean {
  if (ALLOWED_ORIGINS.length > 0) {
    return ALLOWED_ORIGINS.includes(origin);
  }

  return (
    origin.startsWith('chrome-extension://') ||
    origin === 'http://localhost:5173' ||
    origin === 'http://127.0.0.1:5173'
  );
}

function getAccessToken(request: IncomingMessage): string | null {
  const value = request.headers['x-ui-remix-access-token'];
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isInviteTokenAllowed(accessTokenHash: string | null): boolean {
  if (INVITE_TOKEN_HASHES.size === 0) {
    return true;
  }

  if (!accessTokenHash) {
    return false;
  }

  for (const expectedHash of INVITE_TOKEN_HASHES) {
    if (safeEqual(accessTokenHash, expectedHash)) {
      return true;
    }
  }

  return false;
}

function getClientIp(request: IncomingMessage): string {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  return request.socket.remoteAddress ?? 'unknown';
}

function getActorKey(request: IncomingMessage, accessTokenHash: string | null): string {
  return accessTokenHash ? `token:${accessTokenHash}` : `ip:${hashToken(getClientIp(request))}`;
}

async function recordUsage(event: {
  actorKey: string;
  status: number;
  intent?: string;
  candidates?: number;
  targets?: number;
}): Promise<void> {
  try {
    await usageStore.recordUsage(event);
  } catch (error) {
    console.warn('[UI Remix AI] Could not record usage', error);
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function tokenLogId(accessTokenHash: string | null): string {
  return accessTokenHash ? `token:${accessTokenHash.slice(0, 10)}` : 'none';
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function logRequest(
  request: IncomingMessage,
  status: number,
  startedAt: number,
  details: Record<string, string | number | undefined> = {}
): void {
  if (!LOG_REQUESTS || request.method === 'OPTIONS') {
    return;
  }

  const elapsedMs = Date.now() - startedAt;
  const payload = {
    event: 'ui-remix-proxy-request',
    method: request.method,
    path: request.url,
    status,
    elapsedMs,
    ipHash: hashToken(getClientIp(request)).slice(0, 12),
    ...details
  };

  console.info(JSON.stringify(payload));
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

const styleProperties = {
  backgroundColor: { type: 'string' },
  color: { type: 'string' },
  fontSize: { type: 'string' },
  borderRadius: { type: 'string' },
  padding: { type: 'string' },
  width: { type: 'string' },
  height: { type: 'string' }
} as const;

const responseSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'intent',
    'targetCandidateIds',
    'targetDescription',
    'value',
    'styles',
    'preset',
    'confidence',
    'reason'
  ],
  properties: {
    intent: {
      type: 'string',
      enum: ['hide', 'style', 'text', 'preset', 'unknown']
    },
    targetCandidateIds: {
      type: 'array',
      items: {
        type: 'string'
      }
    },
    targetDescription: {
      type: 'string'
    },
    value: {
      type: 'string'
    },
    styles: {
      type: 'object',
      additionalProperties: false,
      required: Object.keys(styleProperties),
      properties: styleProperties
    },
    preset: {
      type: 'string',
      enum: ['remove-distractions', 'focus-mode', 'clean-page', 'none']
    },
    confidence: {
      type: 'number',
      minimum: 0,
      maximum: 1
    },
    reason: {
      type: 'string'
    }
  }
};
