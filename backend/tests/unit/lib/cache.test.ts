import { describe, it, expect } from 'vitest';
import { createCache, Coalescer } from '../../../src/lib/cache.js';

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
