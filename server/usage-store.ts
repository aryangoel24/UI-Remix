import { createClient } from 'redis';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
  count: number;
}

export interface UsageEvent {
  actorKey: string;
  status: number;
  intent?: string;
  candidates?: number;
  targets?: number;
}

export interface UsageStore {
  name: string;
  checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult>;
  recordUsage(event: UsageEvent): Promise<void>;
}

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

type RedisClient = ReturnType<typeof createClient>;

const KEY_PREFIX = process.env.USAGE_STORE_KEY_PREFIX ?? 'ui-remix';
const UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_URL = process.env.REDIS_URL;
const memoryRateLimitBuckets = new Map<string, RateLimitBucket>();
const memoryUsageCounters = new Map<string, Record<string, number>>();

let redisClient: RedisClient | null = null;
let redisConnectPromise: Promise<RedisClient> | null = null;

export function createUsageStore(): UsageStore {
  if (UPSTASH_REDIS_REST_URL && UPSTASH_REDIS_REST_TOKEN) {
    return new UpstashUsageStore(UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN);
  }

  if (REDIS_URL) {
    return new RedisUrlUsageStore(REDIS_URL);
  }

  return new MemoryUsageStore();
}

class MemoryUsageStore implements UsageStore {
  name = 'memory';

  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = memoryRateLimitBuckets.get(key);

    if (!existing || existing.resetAt <= now) {
      memoryRateLimitBuckets.set(key, {
        count: 1,
        resetAt: now + windowMs
      });
      return { allowed: true, retryAfterMs: 0, count: 1 };
    }

    if (existing.count >= limit) {
      return {
        allowed: false,
        retryAfterMs: existing.resetAt - now,
        count: existing.count
      };
    }

    existing.count += 1;
    return { allowed: true, retryAfterMs: 0, count: existing.count };
  }

  async recordUsage(event: UsageEvent): Promise<void> {
    const key = usageKey(event.actorKey);
    const current = memoryUsageCounters.get(key) ?? {};
    incrementUsageFields(current, event);
    memoryUsageCounters.set(key, current);
  }
}

class RedisUrlUsageStore implements UsageStore {
  name = 'redis';

  constructor(private readonly url: string) {}

  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const client = await getRedisClient(this.url);
    const redisKey = rateLimitKey(key);
    const count = await client.incr(redisKey);

    if (count === 1) {
      await client.pExpire(redisKey, windowMs);
    }

    const ttl = await client.pTTL(redisKey);
    return {
      allowed: count <= limit,
      retryAfterMs: ttl > 0 ? ttl : windowMs,
      count
    };
  }

  async recordUsage(event: UsageEvent): Promise<void> {
    const client = await getRedisClient(this.url);
    const key = usageKey(event.actorKey);
    const fields = usageIncrements(event);
    const multi = client.multi();

    for (const [field, value] of Object.entries(fields)) {
      multi.hIncrBy(key, field, value);
    }

    multi.expire(key, secondsUntilTomorrow() + 7 * 24 * 60 * 60);
    await multi.exec();
  }
}

class UpstashUsageStore implements UsageStore {
  name = 'upstash';

  constructor(
    private readonly url: string,
    private readonly token: string
  ) {}

  async checkRateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
    const redisKey = rateLimitKey(key);
    const ttlSeconds = Math.max(1, Math.ceil(windowMs / 1000));
    const responses = await this.pipeline([
      ['INCR', redisKey],
      ['EXPIRE', redisKey, String(ttlSeconds), 'NX'],
      ['PTTL', redisKey]
    ]);
    const count = Number(responses[0]?.result ?? 0);
    const ttl = Number(responses[2]?.result ?? windowMs);

    return {
      allowed: count <= limit,
      retryAfterMs: ttl > 0 ? ttl : windowMs,
      count
    };
  }

  async recordUsage(event: UsageEvent): Promise<void> {
    const key = usageKey(event.actorKey);
    const fields = usageIncrements(event);
    const commands = Object.entries(fields).map(([field, value]) => ['HINCRBY', key, field, String(value)]);
    commands.push(['EXPIRE', key, String(secondsUntilTomorrow() + 7 * 24 * 60 * 60)]);
    await this.pipeline(commands);
  }

  private async pipeline(commands: string[][]): Promise<Array<{ result?: unknown; error?: string }>> {
    const response = await fetch(`${this.url.replace(/\/$/, '')}/pipeline`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify(commands)
    });

    const json = (await response.json()) as Array<{ result?: unknown; error?: string }>;
    if (!response.ok) {
      throw new Error(`Upstash request failed with ${response.status}`);
    }

    const commandError = json.find((item) => item.error);
    if (commandError?.error) {
      throw new Error(commandError.error);
    }

    return json;
  }
}

async function getRedisClient(url: string): Promise<RedisClient> {
  if (redisClient?.isOpen) {
    return redisClient;
  }

  if (!redisConnectPromise) {
    redisClient = createClient({ url });
    redisClient.on('error', (error) => {
      console.warn('[UI Remix AI] Redis error', error);
    });
    redisConnectPromise = redisClient.connect().then(() => redisClient as RedisClient);
  }

  return redisConnectPromise;
}

function rateLimitKey(key: string): string {
  return `${KEY_PREFIX}:rate:${key}`;
}

function usageKey(actorKey: string): string {
  return `${KEY_PREFIX}:usage:${todayKey()}:${actorKey}`;
}

function usageIncrements(event: UsageEvent): Record<string, number> {
  const fields: Record<string, number> = {
    total: 1,
    [`status:${event.status}`]: 1
  };

  if (event.status >= 200 && event.status < 300) {
    fields.success = 1;
  } else {
    fields.error = 1;
  }

  if (event.intent) {
    fields[`intent:${event.intent}`] = 1;
  }

  if (event.candidates) {
    fields.candidates = event.candidates;
  }

  if (event.targets) {
    fields.targets = event.targets;
  }

  return fields;
}

function incrementUsageFields(target: Record<string, number>, event: UsageEvent): void {
  for (const [field, value] of Object.entries(usageIncrements(event))) {
    target[field] = (target[field] ?? 0) + value;
  }
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function secondsUntilTomorrow(): number {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(now.getUTCDate() + 1);
  tomorrow.setUTCHours(0, 0, 0, 0);
  return Math.max(1, Math.ceil((tomorrow.getTime() - now.getTime()) / 1000));
}
