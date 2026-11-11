import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/cache.js', () => ({
  allCaches: [
    { name: 'full', cache: { size: 3 } },
    { name: 'empty', cache: { size: 0 } },
  ],
}));

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sampleMemory, sampleCacheSizes, sampleStorage, estimateCacheMB } from '../../src/lib/memory-telemetry.js';

const MB = 1024 * 1024;

describe('sampleMemory', () => {
  it('reports whole MB and the RSS held outside the V8 heap', () => {
    const sample = sampleMemory({
      rss: 3000 * MB,
      heapTotal: 1500 * MB,
      heapUsed: 1300 * MB,
      external: 200 * MB,
      arrayBuffers: 150 * MB,
    });

    expect(sample).toEqual({
      rssMB: 3000,
      heapUsedMB: 1300,
      heapTotalMB: 1500,
      externalMB: 200,
      arrayBuffersMB: 150,
      nonHeapMB: 1500,
    });
  });
});

describe('sampleStorage', () => {
  it('sums the database, its WAL and the backup folder in MB', () => {
    const dir = mkdtempSync(join(tmpdir(), 'telemetry-'));
    try {
      mkdirSync(join(dir, 'backups'));
      writeFileSync(join(dir, 'app.db'), Buffer.alloc(3 * MB));
      writeFileSync(join(dir, 'app.db-wal'), Buffer.alloc(2 * MB));
      writeFileSync(join(dir, 'backups', 'a.db.gz'), Buffer.alloc(1 * MB));
      writeFileSync(join(dir, 'backups', 'b.db.gz'), Buffer.alloc(2 * MB));

      expect(sampleStorage(join(dir, 'app.db'), join(dir, 'backups'))).toEqual({
        dbMB: 3,
        walMB: 2,
        backupsMB: 3,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports zeros when nothing exists yet', () => {
    expect(sampleStorage('/nope/app.db', '/nope/backups')).toEqual({ dbMB: 0, walMB: 0, backupsMB: 0 });
  });
});

describe('estimateCacheMB', () => {
  const cacheOf = (values: unknown[]) => ({ size: values.length, values: () => values.values() });

  it('scales the sampled entry size by the entry count', () => {
    const entry = { text: 'z'.repeat(1024 * 1024) };
    expect(estimateCacheMB(cacheOf(Array.from({ length: 40 }, () => entry)))).toBeGreaterThanOrEqual(38);
  });

  it('counts Buffers by byte length and ignores what cannot be serialized', () => {
    expect(estimateCacheMB(cacheOf([Buffer.alloc(2 * MB), Buffer.alloc(2 * MB)]))).toBe(4);
    expect(estimateCacheMB(cacheOf([() => 1]))).toBe(0);
    expect(estimateCacheMB(cacheOf([]))).toBe(0);
  });
});

describe('sampleCacheSizes', () => {
  it('lists only caches that hold entries', () => {
    expect(sampleCacheSizes()).toEqual({ full: 3 });
  });
});
