import { redis } from "./cache.ts";

type MemoryWindow = {
  count: number;
  expiresAt: number;
};

type GlobalRateLimitState = {
  windows: Map<string, MemoryWindow>;
};

type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  limit: number;
  count: number;
  key: string;
};

const globalRateLimitState = (() => {
  const scope = globalThis as typeof globalThis & {
    __roomfindrRateLimitState__?: GlobalRateLimitState;
  };

  if (!scope.__roomfindrRateLimitState__) {
    scope.__roomfindrRateLimitState__ = {
      windows: new Map<string, MemoryWindow>(),
    };
  }

  return scope.__roomfindrRateLimitState__;
})();

const getNow = () => Date.now();

const normalizeIp = (value: string | null): string => {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.split(",")[0]?.trim() || "";
};

export const getClientIp = (req: Request): string =>
  normalizeIp(req.headers.get("cf-connecting-ip")) ||
  normalizeIp(req.headers.get("x-forwarded-for")) ||
  normalizeIp(req.headers.get("x-real-ip")) ||
  "unknown";

export const buildRateLimitKey = (
  namespace: string,
  ...parts: Array<string | null | undefined>
): string =>
  [
    "roomfindr",
    "ratelimit",
    namespace,
    ...parts
      .map((part) => String(part || "").trim())
      .filter((part) => part.length > 0),
  ].join(":");

const enforceMemoryRateLimit = (
  key: string,
  limit: number,
  windowSeconds: number,
): RateLimitResult => {
  const now = getNow();
  const windowMs = Math.max(windowSeconds, 1) * 1000;
  const existing = globalRateLimitState.windows.get(key);

  if (!existing || existing.expiresAt <= now) {
    const next: MemoryWindow = {
      count: 1,
      expiresAt: now + windowMs,
    };
    globalRateLimitState.windows.set(key, next);
    return {
      allowed: true,
      remaining: Math.max(limit - 1, 0),
      resetAt: next.expiresAt,
      limit,
      count: next.count,
      key,
    };
  }

  existing.count += 1;
  return {
    allowed: existing.count <= limit,
    remaining: Math.max(limit - existing.count, 0),
    resetAt: existing.expiresAt,
    limit,
    count: existing.count,
    key,
  };
};

export const enforceRateLimit = async (
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<RateLimitResult> => {
  if (!redis) {
    return enforceMemoryRateLimit(key, limit, windowSeconds);
  }

  try {
    const count = Number(await redis.incr(key));
    if (count === 1) {
      await redis.expire(key, Math.max(windowSeconds, 1));
    }

    return {
      allowed: count <= limit,
      remaining: Math.max(limit - count, 0),
      resetAt: getNow() + Math.max(windowSeconds, 1) * 1000,
      limit,
      count,
      key,
    };
  } catch (error) {
    void error;
    return enforceMemoryRateLimit(key, limit, windowSeconds);
  }
};
