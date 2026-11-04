import { describe, it, expect } from 'vitest';
import {
  loadCatalogPage,
  inflightCatalog,
  type CatalogSource,
} from '../../../../src/modules/stremio/catalog/catalog-loader.js';
import type { StremioMeta } from '../../../../src/modules/stremio/catalog.service.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const meta = (id: string): StremioMeta => ({ id, type: 'movie', name: id });
const ids = (from: number, count: number) => Array.from({ length: count }, (_, i) => `tt${from + i}`);

/**
 * Upstream whose pages are released by the test, so it can observe what a
 * request returns before the rest of the catalog has arrived.
 */
function controlledSource(key: string, pageCount: number, overrides: Partial<CatalogSource<string>> = {}) {
  const pages = Array.from({ length: pageCount }, () => deferred<{ items: string[]; cursor?: string }>());
  const fetched: Array<string | undefined> = [];
  const stored: StremioMeta[][] = [];
  const source: CatalogSource<string> = {
    key,
    maxPages: 10,
    fetchPage: (cursor) => {
      fetched.push(cursor);
      return pages[cursor ? Number(cursor) : 0]!.promise;
    },
    toMetas: async (items) => items.map(meta),
    store: (metas) => { stored.push(metas); },
    ...overrides,
  };
  const release = (index: number, items: string[]) =>
    pages[index]!.resolve({ items, cursor: index + 1 < pageCount ? String(index + 1) : undefined });
  return { source, pages, fetched, stored, release };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('loadCatalogPage', () => {
  it('serves the first page as soon as the first upstream page arrives', async () => {
    const { source, release } = controlledSource('first-page', 3);

    const page = loadCatalogPage(source, 0, 2);
    release(0, ids(0, 2));

    expect((await page).map((m) => m.id)).toEqual(['tt0', 'tt1']);
  });

  it('shares one upstream load between concurrent requests for the same catalog', async () => {
    const { source, fetched, release } = controlledSource('shared', 2);

    const first = loadCatalogPage(source, 0, 2);
    const second = loadCatalogPage(source, 2, 2);
    release(0, ids(0, 2));
    release(1, ids(2, 2));

    expect((await first).map((m) => m.id)).toEqual(['tt0', 'tt1']);
    expect((await second).map((m) => m.id)).toEqual(['tt2', 'tt3']);
    expect(fetched).toEqual([undefined, '1']);
  });

  it('serves a later page only once enough of the catalog has arrived', async () => {
    const { source, release } = controlledSource('later-page', 3);
    let settled = false;

    const page = loadCatalogPage(source, 2, 2).then((metas) => { settled = true; return metas; });
    release(0, ids(0, 2));
    await flush();
    expect(settled).toBe(false);

    release(1, ids(2, 2));
    expect((await page).map((m) => m.id)).toEqual(['tt2', 'tt3']);
  });

  it('returns a short last page when the catalog ends before it is full', async () => {
    const { source, release } = controlledSource('short', 1);

    const page = loadCatalogPage(source, 0, 5);
    release(0, ids(0, 3));

    expect(await page).toHaveLength(3);
  });

  it('stores the full catalog once the last upstream page has arrived', async () => {
    const { source, stored, release } = controlledSource('store', 2);

    await Promise.all([loadCatalogPage(source, 0, 2), release(0, ids(0, 2))]);
    expect(stored).toEqual([]);

    release(1, ids(2, 1));
    await flush();
    expect(stored.map((metas) => metas.map((m) => m.id))).toEqual([['tt0', 'tt1', 'tt2']]);
  });

  it('stops after maxPages even when upstream has more', async () => {
    const { source, fetched, stored, release } = controlledSource('max-pages', 3, { maxPages: 2 });

    const page = loadCatalogPage(source, 0, 10);
    release(0, ids(0, 2));
    release(1, ids(2, 2));

    expect(await page).toHaveLength(4);
    expect(fetched).toEqual([undefined, '1']);
    expect(stored[0]).toHaveLength(4);
  });

  it('drops a film an earlier page already produced when deduping', async () => {
    const { source, release } = controlledSource('dedupe', 2, { dedupe: true });

    const page = loadCatalogPage(source, 0, 10);
    release(0, ['tt1', 'tt2']);
    release(1, ['tt2', 'tt3']);

    expect((await page).map((m) => m.id)).toEqual(['tt1', 'tt2', 'tt3']);
  });

  it('waits for the whole catalog when it must be reordered', async () => {
    const { source, stored, release } = controlledSource('finalize', 2, {
      finalize: (metas) => [...metas].reverse(),
    });
    let settled = false;

    const page = loadCatalogPage(source, 0, 2).then((metas) => { settled = true; return metas; });
    release(0, ids(0, 2));
    await flush();
    expect(settled).toBe(false);

    release(1, ids(2, 2));
    expect((await page).map((m) => m.id)).toEqual(['tt3', 'tt2']);
    expect(stored[0]!.map((m) => m.id)).toEqual(['tt3', 'tt2', 'tt1', 'tt0']);
  });

  it('fails the request when upstream fails before its page arrived, and retries on the next one', async () => {
    const { source, pages } = controlledSource('failure', 2);

    const page = loadCatalogPage(source, 0, 2);
    pages[0]!.reject(new Error('upstream down'));
    await expect(page).rejects.toThrow('upstream down');

    const retry = controlledSource('failure', 1);
    const retried = loadCatalogPage(retry.source, 0, 2);
    retry.release(0, ids(0, 2));
    expect(await retried).toHaveLength(2);
  });

  it('keeps a page already served when a later upstream page fails, without storing', async () => {
    const { source, pages, stored, release } = controlledSource('late-failure', 2);

    const page = loadCatalogPage(source, 0, 2);
    release(0, ids(0, 2));
    expect(await page).toHaveLength(2);

    pages[1]!.reject(new Error('upstream down'));
    await flush();
    expect(stored).toEqual([]);
  });
});

describe('inflightCatalog', () => {
  it('resolves with the full catalog of a load in progress', async () => {
    const { source, release } = controlledSource('inflight', 2);

    void loadCatalogPage(source, 0, 2);
    const full = inflightCatalog('inflight');
    release(0, ids(0, 2));
    release(1, ids(2, 2));

    expect((await full)?.map((m) => m.id)).toEqual(['tt0', 'tt1', 'tt2', 'tt3']);
  });

  it('is undefined when nothing is loading under that key', () => {
    expect(inflightCatalog('nothing-loading')).toBeUndefined();
  });

  it('resolves to undefined when the load fails', async () => {
    const { source, pages } = controlledSource('inflight-failure', 1);

    void loadCatalogPage(source, 0, 2).catch(() => undefined);
    const full = inflightCatalog('inflight-failure');
    pages[0]!.reject(new Error('upstream down'));

    expect(await full).toBeUndefined();
  });
});
