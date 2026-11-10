import { allCaches } from './cache.js';
import { createChildLogger } from './logger.js';

const log = createChildLogger('memory-telemetry');

const INTERVAL_MS = 60_000;
const MB = 1024 * 1024;

export interface MemorySample {
  rssMB: number;
  heapUsedMB: number;
  heapTotalMB: number;
  externalMB: number;
  arrayBuffersMB: number;
  /** RSS not accounted for by the V8 heap: native buffers, libraries, allocator slack. */
  nonHeapMB: number;
}

const toMB = (bytes: number) => Math.round(bytes / MB);

/** Where the process memory sits, in whole MB. Billing follows RSS, not the heap. */
export function sampleMemory(usage: NodeJS.MemoryUsage = process.memoryUsage()): MemorySample {
  return {
    rssMB: toMB(usage.rss),
    heapUsedMB: toMB(usage.heapUsed),
    heapTotalMB: toMB(usage.heapTotal),
    externalMB: toMB(usage.external),
    arrayBuffersMB: toMB(usage.arrayBuffers),
    nonHeapMB: toMB(usage.rss - usage.heapTotal),
  };
}

/** Entry count per non-empty cache, to see what fills the heap. */
export function sampleCacheSizes(): Record<string, number> {
  const sizes: Record<string, number> = {};
  for (const { name, cache } of allCaches) {
    if (cache.size > 0) sizes[name] = cache.size;
  }
  return sizes;
}

let intervalId: ReturnType<typeof setInterval> | null = null;

/** Logs process memory once a minute so RSS can be lined up with scheduled jobs. */
export function startMemoryTelemetry(): void {
  if (intervalId) return;
  intervalId = setInterval(() => {
    log.info({ ...sampleMemory(), caches: sampleCacheSizes() }, 'Memory telemetry');
  }, INTERVAL_MS);
  intervalId.unref();
}

export function stopMemoryTelemetry(): void {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
}
