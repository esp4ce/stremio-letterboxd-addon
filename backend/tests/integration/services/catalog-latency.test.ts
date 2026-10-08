import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { configure } from '@esp4ce/letterboxd-client';
import { makeWatchlistFilm } from '../../helpers/msw-server.js';
import { fetchListCatalogPublic } from '../../../src/modules/stremio/catalog/public-catalog-fetcher.service.js';
import { catalogConfig } from '../../../src/config/index.js';

// Diagnostic harness: latency of public list catalogs (see /diagnose on catalog latency).
// Counts upstream calls and measures wall-clock time for a cold list fetch.

const LIST_SIZE = 829; // same order of magnitude as a large real list seen in prod logs
const PER_PAGE = 100;
const PACER_MS = 200; // MIN_INTERVAL_MS in src/lib/retry.ts

let listCalls = 0;

const listHandler = http.get("*/list/:id/entries", ({ request, params }) => {
  listCalls++;
  const url = new URL(request.url);
  const cursor = url.searchParams.get('cursor');
  const offset = cursor ? Number(cursor.replace('start=', '')) : 0;
  const perPage = Number(url.searchParams.get('perPage') ?? PER_PAGE);
  const end = Math.min(offset + perPage, LIST_SIZE);

  const items = Array.from({ length: end - offset }, (_, i) => {
    const n = offset + i;
    return {
      rank: n + 1,
      film: makeWatchlistFilm({
        id: `${String(params['id'])}-f${n}`,
        name: `Film ${n}`,
        links: [{ type: 'imdb', id: `tt${String(n).padStart(7, '0')}`, url: '' }],
      }),
    };
  });

  return HttpResponse.json({ items, next: end < LIST_SIZE ? `start=${end}` : undefined });
});

const authHandler = http.all("*/auth/token", () =>
  HttpResponse.json({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'test-refresh-token' }),
);

const server = setupServer(listHandler, authHandler);

beforeAll(() => {
  configure({ clientId: catalogConfig.clientId, clientSecret: catalogConfig.clientSecret, userAgent: catalogConfig.userAgent });
  server.listen({ onUnhandledRequest: 'error' });
});
afterAll(() => server.close());

describe('public list catalog latency (diagnostic)', () => {
  it('cold fetch of an 829-entry list: pages fetched and wall-clock time', async () => {
    listCalls = 0;
    const started = Date.now();
    const { metas } = await fetchListCatalogPublic('solo', 0, true);
    const elapsed = Date.now() - started;

    console.log(`[HARNESS] solo: listCalls=${listCalls} elapsed=${elapsed}ms returned=${metas.length}`);

    expect(metas).toHaveLength(PER_PAGE);
    expect(listCalls).toBe(Math.ceil(LIST_SIZE / PER_PAGE));
    // Pacer floor: each upstream call costs at least PACER_MS, even on an instant response.
    expect(elapsed).toBeGreaterThanOrEqual(listCalls * PACER_MS * 0.9);
  }, 30_000);

  it('warm fetch of the same list is served from cache (no upstream calls)', async () => {
    listCalls = 0;
    const started = Date.now();
    const { metas } = await fetchListCatalogPublic('solo', 100, true);
    const elapsed = Date.now() - started;

    console.log(`[HARNESS] solo warm: listCalls=${listCalls} elapsed=${elapsed}ms returned=${metas.length}`);

    expect(listCalls).toBe(0);
    expect(metas).toHaveLength(PER_PAGE);
  }, 30_000);

  // Characterisation test: it documents the current global upstream throughput ceiling
  // (one request start every MIN_INTERVAL_MS, service-wide). Update it when that changes.
  it('cold lists fetched concurrently: the global pacer serialises them', async () => {
    listCalls = 0;
    const ids = Array.from({ length: 4 }, (_, i) => `burst-${i}`);
    const started = Date.now();
    await Promise.all(ids.map((id) => fetchListCatalogPublic(id, 0, true)));
    const elapsed = Date.now() - started;

    const expectedCalls = ids.length * Math.ceil(LIST_SIZE / PER_PAGE);
    console.log(
      `[HARNESS] burst: listCalls=${listCalls} (expected ${expectedCalls}) elapsed=${elapsed}ms ` +
        `floor=${listCalls * PACER_MS}ms`,
    );

    expect(listCalls).toBe(expectedCalls);
    expect(elapsed).toBeGreaterThanOrEqual(listCalls * PACER_MS * 0.9);
  }, 60_000);
});
