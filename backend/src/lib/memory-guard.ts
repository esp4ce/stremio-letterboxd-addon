import { heavyCaches } from './cache.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger('memory-guard');

const HEAP_LIMIT_MB = 512;
const CHECK_INTERVAL_MS = 30_000;

const enum Tier {
  NORMAL = 'NORMAL',
  ELEVATED = 'ELEVATED',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL',
}

interface PurgeResult {
  tier: Tier;
  heapMB: number;
  purged: number;
}

function getHeapMB(): number {
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

function getTier(heapMB: number): Tier {
  const pct = (heapMB / HEAP_LIMIT_MB) * 100;
  if (pct > 85) return Tier.CRITICAL;
  if (pct > 75) return Tier.HIGH;
  if (pct > 60) return Tier.ELEVATED;
  return Tier.NORMAL;
}

/**
 * Evict `fraction` of entries from the given caches.
 * Iterates keys and deletes the first N (LRU-ordered oldest first).
 */
function evictFraction(
  caches: ReadonlyArray<{ name: string; cache: { size: number; keys: () => IterableIterator<string>; delete: (k: string) => boolean } }>,
  fraction: number,
): number {
  let total = 0;
  for (const { cache } of caches) {
    const toEvict = Math.ceil(cache.size * fraction);
    if (toEvict === 0) continue;
    let evicted = 0;
    for (const key of cache.keys()) {
      if (evicted >= toEvict) break;
      cache.delete(key);
      evicted++;
    }
    total += evicted;
  }
  return total;
}

export function checkMemoryPressure(): PurgeResult | null {
  const heapMB = getHeapMB();
  const tier = getTier(heapMB);

  if (tier === Tier.NORMAL) return null;

  let purged = 0;

  if (tier === Tier.ELEVATED) {
    const sorted = [...heavyCaches]
      .filter(({ cache }) => cache.size > 0)
      .sort((a, b) => {
        const ratioA = a.cache.size / a.cache.max;
        const ratioB = b.cache.size / b.cache.max;
        return ratioB - ratioA;
      })
      .slice(0, 3);
    purged = evictFraction(sorted, 0.25);
  } else if (tier === Tier.HIGH) {
    purged = evictFraction(heavyCaches, 0.50);
  } else {
    for (const { cache } of heavyCaches) {
      purged += cache.size;
      cache.clear();
    }
    global.gc?.();
  }

  const result: PurgeResult = { tier, heapMB: Math.round(heapMB), purged };

  if (tier === Tier.CRITICAL) {
    log.error(result, 'CRITICAL memory pressure — cleared all heavy caches');
  } else {
    log.warn(result, `${tier} memory pressure — evicted entries`);
  }

  return result;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startMemoryGuard(): void {
  if (intervalId) return;
  intervalId = setInterval(checkMemoryPressure, CHECK_INTERVAL_MS);
  intervalId.unref();
  log.info({ intervalMs: CHECK_INTERVAL_MS, heapLimitMB: HEAP_LIMIT_MB }, 'Memory guard started');
}

export function stopMemoryGuard(): void {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
}
