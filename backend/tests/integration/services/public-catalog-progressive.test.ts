import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { configure } from '@esp4ce/letterboxd-client';
import { makeWatchlistFilm } from '../../helpers/msw-server.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import {
  fetchListCatalogPublic,
  handlePublicCatalogRequest,
} from '../../../src/modules/stremio/catalog/public-catalog-fetcher.service.js';
import { inflightCatalog } from '../../../src/modules/stremio/catalog/catalog-loader.js';
import { cacheKeyPublicList } from '../../../src/modules/stremio/catalog/catalog-cache-keys.js';
import { publicListCache, PUBLIC_LIST_FRESH_MS } from '../../../src/lib/cache.js';
import { catalogConfig } from '../../../src/config/index.js';

const LIST_SIZE = 450;
const PER_PAGE = 100;
const PAGES = Math.ceil(LIST_SIZE / PER_PAGE);
const UNRELEASED_YEAR = new Date().getFullYear() + 5;

let listCalls = 0;

const listHandler = http.get('*/list/:id/entries', ({ request, params }) => {
  listCalls++;
  const listId = String(params['id']);
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const offset = cursor ? Number(cursor.replace('start=', '')) : 0;
  const end = Math.min(offset + PER_PAGE, LIST_SIZE);

  const items = Array.from({ length: end - offset }, (_, i) => {
    const n = offset + i;
    return {
      rank: n + 1,
      film: makeWatchlistFilm({
        id: `${listId}-f${n}`,
        name: `Film ${n}`,
        // The 'upcoming' list opens with 60 films that aren't out yet.
        releaseYear: listId === 'upcoming' && n < 60 ? UNRELEASED_YEAR : 2000,
        links: [{ type: 'imdb', id: `tt${String(n).padStart(7, '0')}`, url: '' }],
      }),
    };
  });

  return HttpResponse.json({ items, next: end < LIST_SIZE ? `start=${end}` : undefined });
});

const server = setupServer(
  listHandler,
  http.all('*/auth/token', () =>
    HttpResponse.json({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'test-refresh-token' }),
  ),
  http.get('https://v3-cinemeta.strem.io/meta/movie/:id.json', () => HttpResponse.json({}, { status: 404 })),
);

beforeAll(() => {
  initDb();
  configure({ clientId: catalogConfig.clientId, clientSecret: catalogConfig.clientSecret, userAgent: catalogConfig.userAgent });
  server.listen({ onUnhandledFrame: 'error' });
});
afterAll(() => {
  server.close();
  closeDb();
});

const listKey = (listId: string) => cacheKeyPublicList(listId, true);

describe('public list catalog loading', () => {
  it('answers the first page of a cold list before the rest of the list is loaded', async () => {
    const { metas } = await fetchListCatalogPublic('cold', 0, true);

    expect(metas.map((m) => m.id)).toEqual(Array.from({ length: PER_PAGE }, (_, n) => `tt${String(n).padStart(7, '0')}`));
    expect(publicListCache.get(listKey('cold'))).toBeUndefined();

    const full = await inflightCatalog(listKey('cold'));
    expect(full).toHaveLength(LIST_SIZE);
    expect(publicListCache.get(listKey('cold'))?.metas).toHaveLength(LIST_SIZE);
  }, 30_000);

  it('loads a list once for concurrent requests on different pages', async () => {
    listCalls = 0;

    const [first, fourth] = await Promise.all([
      fetchListCatalogPublic('concurrent', 0, true),
      fetchListCatalogPublic('concurrent', 300, true),
    ]);

    expect(first.metas[0]?.id).toBe('tt0000000');
    expect(fourth.metas[0]?.id).toBe('tt0000300');
    await inflightCatalog(listKey('concurrent'));
    expect(listCalls).toBe(PAGES);
  }, 30_000);

  it('serves a fresh list from cache without asking upstream', async () => {
    await fetchListCatalogPublic('fresh', 0, true);
    await inflightCatalog(listKey('fresh'));
    listCalls = 0;

    const { metas } = await fetchListCatalogPublic('fresh', 100, true);

    expect(metas[0]?.id).toBe('tt0000100');
    expect(listCalls).toBe(0);
    expect(inflightCatalog(listKey('fresh'))).toBeUndefined();
  }, 30_000);

  it('serves a stale list at once and refreshes it in the background', async () => {
    const stale = [{ id: 'tt9999999', type: 'movie' as const, name: 'Old entry' }];
    // Written with less TTL left than a fresh entry would have, i.e. written long ago.
    publicListCache.set(listKey('stale'), { metas: stale }, { ttl: publicListCache.ttl - PUBLIC_LIST_FRESH_MS - 1000 });
    listCalls = 0;

    const { metas } = await fetchListCatalogPublic('stale', 0, true);

    expect(metas).toEqual(stale);
    expect(listCalls).toBe(0);

    await inflightCatalog(listKey('stale'));
    expect(publicListCache.get(listKey('stale'))?.metas).toHaveLength(LIST_SIZE);
  }, 30_000);

  it('hides unreleased films from full pages while the list is still loading', async () => {
    const cfg = { c: { popular: false, top250: false }, l: ['upcoming'], r: true, h: true };

    const { metas } = await handlePublicCatalogRequest(cfg, 'letterboxd-list-upcoming');

    expect(metas).toHaveLength(PER_PAGE);
    expect(metas[0]?.id).toBe('tt0000060');
  }, 30_000);
});
