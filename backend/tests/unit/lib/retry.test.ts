import { describe, it, expect, vi } from 'vitest';
import { throttled } from '../../../src/lib/retry.js';
import { LetterboxdApiError } from '../../../src/modules/letterboxd/letterboxd.client.js';

describe('throttled', () => {
  it('returns the result of a successful function', async () => {
    const result = await throttled(() => Promise.resolve('ok'));

    expect(result).toBe('ok');
  });

  it('propagates non-429 errors immediately', async () => {
    await expect(
      throttled(() => Promise.reject(new Error('network down'))),
    ).rejects.toThrow('network down');
  });

  it('propagates non-429 LetterboxdApiError without retry', async () => {
    const fn = vi.fn().mockRejectedValue(new LetterboxdApiError(500, 'server error'));

    await expect(throttled(fn)).rejects.toThrow(LetterboxdApiError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 and succeeds on next attempt', async () => {
    let calls = 0;
    const result = await throttled(async () => {
      calls++;
      if (calls === 1) throw new LetterboxdApiError(429, 'rate limited');
      return 'recovered';
    });

    expect(result).toBe('recovered');
    expect(calls).toBe(2);
  }, 10_000);

  it('exhausts retries on persistent 429', async () => {
    await expect(
      throttled(() => Promise.reject(new LetterboxdApiError(429, 'rate limited'))),
    ).rejects.toThrow(LetterboxdApiError);
  }, 30_000);

  it('handles concurrent calls without deadlock', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => throttled(() => Promise.resolve(i))),
    );

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
