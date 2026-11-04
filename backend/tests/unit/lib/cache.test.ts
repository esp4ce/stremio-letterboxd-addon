import { describe, it, expect } from 'vitest';
import { createCache, Coalescer, isStale } from '../../../src/lib/cache.js';

describe('cache (LRU wrapper)', () => {
  it('stores and retrieves a value', () => {
    const cache = createCache<string>({ maxSize: 10, ttl: 60_000 });
    cache.set('key1', 'value1');

    expect(cache.get('key1')).toBe('value1');
  });

  it('returns undefined on miss', () => {
    const cache = createCache<string>({ maxSize: 10, ttl: 60_000 });

    expect(cache.get('nonexistent')).toBeUndefined();
  });

  it('expires entries after TTL', async () => {
    // lru-cache uses Date.now() internally, not setTimeout — fake timers don't help.
    // Use a very short real TTL instead.
    const cache = createCache<string>({ maxSize: 10, ttl: 50 });
    cache.set('key1', 'value1');

    expect(cache.get('key1')).toBe('value1');
    await new Promise((r) => setTimeout(r, 100));

    expect(cache.get('key1')).toBeUndefined();
  });

  it('keeps an entry readable but stale once it is older than its freshness window', async () => {
    const cache = createCache<string>({ maxSize: 10, ttl: 60_000 });
    cache.set('key1', 'value1');

    expect(isStale(cache, 'key1', 50)).toBe(false);
    await new Promise((r) => setTimeout(r, 100));

    expect(isStale(cache, 'key1', 50)).toBe(true);
    expect(cache.get('key1')).toBe('value1');
  });

  it('evicts LRU entry when max size reached', () => {
    const cache = createCache<string>({ maxSize: 2, ttl: 60_000 });
    cache.set('a', '1');
    cache.set('b', '2');
    cache.set('c', '3'); // should evict 'a'

    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe('2');
    expect(cache.get('c')).toBe('3');
  });

  it('delete forces immediate miss', () => {
    const cache = createCache<string>({ maxSize: 10, ttl: 60_000 });
    cache.set('key1', 'value1');
    cache.delete('key1');

    expect(cache.get('key1')).toBeUndefined();
  });

  describe('updateAgeOnGet', () => {
    // Wide margins on purpose: this suite runs 51 test files in parallel workers,
    // and tight timing windows (seen with 60/100ms) flake under that scheduling load.
    it('does not reset the TTL on read by default (#60 regression guard)', async () => {
      const cache = createCache<string>({ maxSize: 10, ttl: 300 });
      cache.set('key1', 'value1');

      await new Promise((r) => setTimeout(r, 150));
      expect(cache.get('key1')).toBe('value1'); // still alive, but read does not extend it

      await new Promise((r) => setTimeout(r, 300)); // 450ms since set, past the 300ms ttl
      expect(cache.get('key1')).toBeUndefined();
    });

    it('resets the TTL on every read when enabled, keeping an actively-paginated entry alive', async () => {
      const cache = createCache<string>({ maxSize: 10, ttl: 300, updateAgeOnGet: true });
      cache.set('key1', 'value1');

      // Two reads spaced 150ms apart (< ttl) each refresh the age, so the entry survives
      // well past the original 300ms window as long as it keeps being read.
      await new Promise((r) => setTimeout(r, 150));
      expect(cache.get('key1')).toBe('value1');

      await new Promise((r) => setTimeout(r, 150)); // 300ms since set, but only 150ms since last read
      expect(cache.get('key1')).toBe('value1');

      // Once reads stop for a full ttl window, it does expire.
      await new Promise((r) => setTimeout(r, 400));
      expect(cache.get('key1')).toBeUndefined();
    });
  });
});

describe('Coalescer', () => {
  it('deduplicates concurrent calls with the same key', async () => {
    const coalescer = new Coalescer<string>();
    let callCount = 0;

    const fn = () => new Promise<string>((resolve) => {
      callCount++;
      setTimeout(() => resolve('result'), 10);
    });

    const [a, b] = await Promise.all([
      coalescer.run('key', fn),
      coalescer.run('key', fn),
    ]);

    expect(a).toBe('result');
    expect(b).toBe('result');
    expect(callCount).toBe(1);
  });

  it('allows new call after previous resolves', async () => {
    const coalescer = new Coalescer<string>();
    let callCount = 0;

    const fn = () => {
      callCount++;
      return Promise.resolve('result');
    };

    await coalescer.run('key', fn);
    await coalescer.run('key', fn);

    expect(callCount).toBe(2);
  });

  it('tracks inflight size', async () => {
    const coalescer = new Coalescer<string>();
    expect(coalescer.size).toBe(0);

    let resolve!: (v: string) => void;
    const promise = coalescer.run('key', () => new Promise<string>((r) => { resolve = r; }));

    expect(coalescer.size).toBe(1);
    resolve('done');
    await promise;
    expect(coalescer.size).toBe(0);
  });
});
