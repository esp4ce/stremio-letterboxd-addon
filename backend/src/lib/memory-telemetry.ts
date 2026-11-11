import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { serialize } from 'node:v8';
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

const BYTES_SAMPLE_PER_CACHE = 5;
const BYTES_EVERY_MS = 10 * 60_000;

interface SizedCache {
  size: number;
  values(): IterableIterator<unknown>;
}

/**
 * Rough bytes held by one cache: serialized size of a few evenly spaced entries times the
 * entry count. values() does not touch LRU recency, so sampling never changes what is evicted.
 */
export function estimateCacheMB(cache: SizedCache): number {
  const total = cache.size;
  if (total === 0) return 0;
  const step = Math.max(1, Math.floor(total / BYTES_SAMPLE_PER_CACHE));
  let sampled = 0;
  let bytes = 0;
  let index = 0;
  for (const value of cache.values()) {
    if (index++ % step !== 0) continue;
    try {
      bytes += Buffer.isBuffer(value) ? value.byteLength : serialize(value).byteLength;
      sampled++;
    } catch {
      // Not serializable (functions, native handles): leave it out of the sample.
    }
    if (sampled >= BYTES_SAMPLE_PER_CACHE) break;
  }
  if (sampled === 0) return 0;
  return Math.round(((bytes / sampled) * total) / MB);
}

/** Estimated MB per cache, only for caches above 1 MB. */
export function sampleCacheMB(): Record<string, number> {
  const result: Record<string, number> = {};
  for (const { name, cache } of allCaches) {
    const mb = estimateCacheMB(cache as unknown as SizedCache);
    if (mb >= 1) result[name] = mb;
  }
  return result;
}

export interface StorageSample {
  dbMB: number;
  walMB: number;
  backupsMB: number;
}

const fileMB = (path: string): number => {
  try {
    return statSync(path).size / MB;
  } catch {
    return 0;
  }
};

/**
 * Size of the database, its WAL and the local backups. The container's memory counts
 * file cache, so what sits on the volume is a suspect for the gap between RSS and the bill.
 */
export function sampleStorage(dbPath: string, backupDir: string): StorageSample {
  let backupsBytes = 0;
  try {
    for (const name of readdirSync(backupDir)) {
      backupsBytes += fileMB(join(backupDir, name));
    }
  } catch {
    // No backup directory yet.
  }
  return {
    dbMB: Math.round(fileMB(dbPath)),
    walMB: Math.round(fileMB(`${dbPath}-wal`)),
    backupsMB: Math.round(backupsBytes),
  };
}

let intervalId: ReturnType<typeof setInterval> | null = null;
let bytesIntervalId: ReturnType<typeof setInterval> | null = null;

/** Logs process memory once a minute so RSS can be lined up with scheduled jobs. */
export function startMemoryTelemetry(dbPath: string, backupDir: string): void {
  if (intervalId) return;
  intervalId = setInterval(() => {
    log.info(
      { ...sampleMemory(), ...sampleStorage(dbPath, backupDir), caches: sampleCacheSizes() },
      'Memory telemetry',
    );
  }, INTERVAL_MS);
  intervalId.unref();

  bytesIntervalId = setInterval(() => {
    log.info({ cacheMB: sampleCacheMB() }, 'Cache memory estimate');
  }, BYTES_EVERY_MS);
  bytesIntervalId.unref();
}

export function stopMemoryTelemetry(): void {
  if (intervalId) clearInterval(intervalId);
  if (bytesIntervalId) clearInterval(bytesIntervalId);
  intervalId = null;
  bytesIntervalId = null;
}
