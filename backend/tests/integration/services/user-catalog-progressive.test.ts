import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { configure } from '@esp4ce/letterboxd-client';
import { makeWatchlistFilm } from '../../helpers/msw-server.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { createUser, type User } from '../../../src/db/repositories/user.repository.js';
import { fetchDiaryCatalog, fetchWatchlistCatalog } from '../../../src/modules/stremio/catalog/catalog-fetcher.service.js';
import { inflightCatalog } from '../../../src/modules/stremio/catalog/catalog-loader.js';
import { cacheKeyDiary, cacheKeyWatchlist } from '../../../src/modules/stremio/catalog/catalog-cache-keys.js';
import { userCatalogCache } from '../../../src/lib/cache.js';
import { catalogConfig } from '../../../src/config/index.js';

const SIZE = 250;
const PER_PAGE = 100;
const PAGES = Math.ceil(SIZE / PER_PAGE);

const imdb = (n: number) => `tt${String(n).padStart(7, '0')}`;
const film = (n: number) => makeWatchlistFilm({ id: `f${n}`, name: `Film ${n}`, links: [{ type: 'imdb', id: imdb(n), url: '' }] });

/** Paginated upstream response over `SIZE` items built by `item`. */
function page(request: Request, item: (n: number) => unknown) {
  const cursor = new URL(request.url).searchParams.get('cursor');
  const offset = cursor ? Number(cursor.replace('start=', '')) : 0;
  const end = Math.min(offset + PER_PAGE, SIZE);
  const items = Array.from({ length: end - offset }, (_, i) => item(offset + i));
  return HttpResponse.json({ items, next: end < SIZE ? `start=${end}` : undefined });
}

let upstreamCalls = 0;

const server = setupServer(
  http.all('*/auth/token', () =>
    HttpResponse.json({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'test-refresh-token' }),
  ),
  http.get('*/member/:id/watchlist', ({ request }) => {
    upstreamCalls++;
    return page(request, film);
  }),
  http.get('*/log-entries', ({ request }) => {
    upstreamCalls++;
    // Film 0 is logged again as the first entry of the second page: a rewatch.
    return page(request, (n) => ({
      id: `log-${n}`,
      diaryDate: '2024-01-15',
      film: film(n === PER_PAGE ? 0 : n),
    }));
  }),
);

let user: User;

beforeAll(() => {
  initDb();
  configure({ clientId: catalogConfig.clientId, clientSecret: catalogConfig.clientSecret, userAgent: catalogConfig.userAgent });
  server.listen({ onUnhandledFrame: 'error' });
  user = createUser({ letterboxdId: 'progressive-member', letterboxdUsername: 'progressive', refreshToken: 'test-refresh-token' });
});
afterAll(() => {
  server.close();
  closeDb();
});

describe('authenticated catalog loading', () => {
  it('answers the first watchlist page before the rest of the watchlist is loaded', async () => {
    const key = cacheKeyWatchlist(user.id, true);

    const { metas } = await fetchWatchlistCatalog(user, 0, true);

    expect(metas.map((m) => m.id)).toEqual(Array.from({ length: PER_PAGE }, (_, n) => imdb(n)));
    expect(userCatalogCache.get(key)).toBeUndefined();

    await inflightCatalog(key);
    expect(userCatalogCache.get(key)?.metas).toHaveLength(SIZE);
  }, 30_000);

  it('loads the diary once for concurrent pages and drops a rewatch from a later page', async () => {
    const key = cacheKeyDiary(user.id, true);
    upstreamCalls = 0;

    const [first, second] = await Promise.all([
      fetchDiaryCatalog(user, 0, true),
      fetchDiaryCatalog(user, PER_PAGE, true),
    ]);

    expect(first.metas[0]?.id).toBe(imdb(0));
    // The rewatch of film 0 is skipped, so the second page starts at film 101.
    expect(second.metas[0]?.id).toBe(imdb(PER_PAGE + 1));
    await inflightCatalog(key);
    expect(upstreamCalls).toBe(PAGES);
    expect(userCatalogCache.get(key)?.metas).toHaveLength(SIZE - 1);
  }, 30_000);
});
