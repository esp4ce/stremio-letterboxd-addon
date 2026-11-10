import { describe, it, expect, vi } from 'vitest';

vi.mock('../../src/lib/cache.js', () => ({
  allCaches: [
    { name: 'full', cache: { size: 3 } },
    { name: 'empty', cache: { size: 0 } },
  ],
}));

import { sampleMemory, sampleCacheSizes } from '../../src/lib/memory-telemetry.js';

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

describe('sampleCacheSizes', () => {
  it('lists only caches that hold entries', () => {
    expect(sampleCacheSizes()).toEqual({ full: 3 });
  });
});
