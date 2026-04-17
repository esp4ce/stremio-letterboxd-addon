import { describe, it, expect } from 'vitest';
import { mapConcurrent } from '../../../src/lib/concurrency.js';

describe('mapConcurrent', () => {
  it('processes all items and preserves order', async () => {
    const result = await mapConcurrent([1, 2, 3, 4, 5], 2, async (n) => n * 10);

    expect(result).toEqual([10, 20, 30, 40, 50]);
  });

  it('returns empty array for empty input', async () => {
    const result = await mapConcurrent([], 3, async (n: number) => n);

    expect(result).toEqual([]);
  });

  it('respects concurrency limit', async () => {
    let maxConcurrent = 0;
    let running = 0;

    const result = await mapConcurrent([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++;
      maxConcurrent = Math.max(maxConcurrent, running);
      await new Promise((r) => setTimeout(r, 10));
      running--;
      return n;
    });

    expect(result).toEqual([1, 2, 3, 4, 5, 6]);
    expect(maxConcurrent).toBeLessThanOrEqual(2);
  });

  it('propagates errors from the mapped function', async () => {
    await expect(
      mapConcurrent([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });

  it('handles concurrency larger than item count', async () => {
    const result = await mapConcurrent([1, 2], 100, async (n) => n + 1);

    expect(result).toEqual([2, 3]);
  });
});
