import { describe, it, expect } from 'vitest';
import {
  getUserCatalogCached,
  setUserCatalog,
  invalidateUserCatalogs,
  cacheMetrics,
} from '../../../src/lib/cache.js';
import type { StremioMeta } from '../../../src/modules/stremio/catalog.service.js';

// app-client tests: test the cache layer used by app-client for catalog caching

describe('user catalog cache operations', () => {
  const makeMeta = (id: string): StremioMeta => ({
    id,
    type: 'movie',
    name: `Film ${id}`,
    year: 2024,
  });

  it('returns undefined on cache miss', () => {
    const result = getUserCatalogCached('nonexistent-key', 0, 20);
    expect(result).toBeUndefined();
  });

  it('stores and retrieves paginated catalog', () => {
    const allMetas = [makeMeta('tt1'), makeMeta('tt2'), makeMeta('tt3')];
    const result = setUserCatalog('user-cache-1', 'test-key-1', allMetas, 0, 2);

    expect(result.metas).toHaveLength(2);
    expect(result.metas[0]!.id).toBe('tt1');
    expect(result.metas[1]!.id).toBe('tt2');
  });

  it('returns paginated slice from cache', () => {
    const allMetas = Array.from({ length: 10 }, (_, i) => makeMeta(`tt${i}`));
    setUserCatalog('user-cache-2', 'test-key-2', allMetas, 0, 10);

    const cached = getUserCatalogCached('test-key-2', 5, 3);
    expect(cached).toBeDefined();
    expect(cached!.metas).toHaveLength(3);
    expect(cached!.metas[0]!.id).toBe('tt5');
  });

  it('invalidates all catalogs for a user', () => {
    const metas = [makeMeta('tt99')];
    setUserCatalog('user-cache-3', 'key-a', metas, 0, 1);
    setUserCatalog('user-cache-3', 'key-b', metas, 0, 1);

    invalidateUserCatalogs('user-cache-3');

    expect(getUserCatalogCached('key-a', 0, 1)).toBeUndefined();
    expect(getUserCatalogCached('key-b', 0, 1)).toBeUndefined();
  });

  it('tracks cache hit/miss metrics', () => {
    const initialHits = cacheMetrics.catalogHits;
    const initialMisses = cacheMetrics.catalogMisses;

    setUserCatalog('user-metrics', 'metrics-key', [makeMeta('tt100')], 0, 1);
    getUserCatalogCached('metrics-key', 0, 1);

    expect(cacheMetrics.catalogMisses).toBe(initialMisses + 1);
    expect(cacheMetrics.catalogHits).toBe(initialHits + 1);
  });
});
