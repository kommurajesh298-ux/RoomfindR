import { Redis } from "npm:@upstash/redis";

type MemoryCacheEntry = {
  expiresAt: number;
  value: string;
};

type GlobalCacheState = {
  values: Map<string, MemoryCacheEntry>;
  inFlight: Map<string, Promise<unknown>>;
};

const globalCacheState = (() => {
  const scope = globalThis as typeof globalThis & {
    __roomfindrEdgeCacheState__?: GlobalCacheState;
  };

  if (!scope.__roomfindrEdgeCacheState__) {
    scope.__roomfindrEdgeCacheState__ = {
      values: new Map<string, MemoryCacheEntry>(),
      inFlight: new Map<string, Promise<unknown>>(),
    };
  }

  return scope.__roomfindrEdgeCacheState__;
})();

const getNow = () => Date.now();
const isCacheDebugEnabled = () => String(Deno.env.get("CACHE_DEBUG") || "").trim().toLowerCase() === "true";

const logCacheEvent = (event: string, key: string, details?: Record<string, unknown>) => {
  if (!isCacheDebugEnabled()) return;
  void event;
  void key;
  void details;
};

const getUpstashConfig = () => {
  const baseUrl = String(Deno.env.get("UPSTASH_REDIS_REST_URL") || "").trim().replace(/\/+$/, "");
  const token = String(Deno.env.get("UPSTASH_REDIS_REST_TOKEN") || "").trim();
  if (!baseUrl || !token) return null;
  return { baseUrl, token };
};

export const redis = (() => {
  const config = getUpstashConfig();
  if (!config) return null;

  return new Redis({
    url: config.baseUrl,
    token: config.token,
  });
})();

const getMemoryEntry = (key: string): string | null => {
  const entry = globalCacheState.values.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= getNow()) {
    globalCacheState.values.delete(key);
    return null;
  }
  return entry.value;
};

const setMemoryEntry = (key: string, value: string, ttlSeconds: number) => {
  globalCacheState.values.set(key, {
    value,
    expiresAt: getNow() + Math.max(ttlSeconds, 1) * 1000,
  });
};

const deleteMemoryEntry = (key: string) => {
  globalCacheState.values.delete(key);
};

export const getCachedJson = async <T>(key: string): Promise<T | null> => {
  const memoryValue = getMemoryEntry(key);
  if (memoryValue) {
    try {
      logCacheEvent("CACHE HIT", key, { layer: "memory" });
      return JSON.parse(memoryValue) as T;
    } catch {
      deleteMemoryEntry(key);
    }
  }

  try {
    if (!redis) {
      logCacheEvent("CACHE MISS", key, { layer: "redis-unconfigured" });
      return null;
    }

    const result = await redis.get<string>(key);
    if (typeof result !== "string" || !result) {
      logCacheEvent("CACHE MISS", key, { layer: "redis" });
      return null;
    }

    setMemoryEntry(key, result, 15);
    logCacheEvent("CACHE HIT", key, { layer: "redis" });
    return JSON.parse(result) as T;
  } catch (error) {
    void error;
    logCacheEvent("CACHE MISS", key, { layer: "error" });
    return null;
  }
};

export const setCachedJson = async <T>(key: string, value: T, ttlSeconds: number): Promise<void> => {
  const serialized = JSON.stringify(value);
  setMemoryEntry(key, serialized, ttlSeconds);

  try {
    if (!redis) {
      logCacheEvent("CACHE SKIP", key, { layer: "redis-unconfigured", operation: "set" });
      return;
    }

    await redis.set(key, serialized, { ex: Math.max(ttlSeconds, 1) });
    logCacheEvent("CACHE SET", key, { layer: "redis", ttlSeconds: Math.max(ttlSeconds, 1) });
  } catch (error) {
    void error;
  }
};

export const deleteCachedJson = async (key: string): Promise<void> => {
  deleteMemoryEntry(key);

  try {
    if (!redis) {
      logCacheEvent("CACHE SKIP", key, { layer: "redis-unconfigured", operation: "delete" });
      return;
    }

    await redis.del(key);
    logCacheEvent("CACHE DELETE", key, { layer: "redis" });
  } catch (error) {
    void error;
  }
};

export const withSingleFlight = async <T>(key: string, factory: () => Promise<T>): Promise<T> => {
  const existing = globalCacheState.inFlight.get(key);
  if (existing) {
    logCacheEvent("CACHE JOIN", key, { layer: "single-flight" });
    return existing as Promise<T>;
  }

  logCacheEvent("CACHE MISS", key, { layer: "single-flight" });
  const promise = factory().finally(() => {
    globalCacheState.inFlight.delete(key);
  });

  globalCacheState.inFlight.set(key, promise);
  return promise;
};

export const getCachedData = async <T>(
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T>,
): Promise<T> => {
  const cached = await getCachedJson<T>(key);
  if (cached !== null) {
    return cached;
  }

  return await withSingleFlight(`cache-fetch:${key}`, async () => {
    const secondLook = await getCachedJson<T>(key);
    if (secondLook !== null) {
      return secondLook;
    }

    const data = await fetchFn();
    await setCachedJson(key, data, ttlSeconds);
    return data;
  });
};
