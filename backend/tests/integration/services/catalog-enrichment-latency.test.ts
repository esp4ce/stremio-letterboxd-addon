import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse, delay } from 'msw';
import { enrichMetasWithCinemeta, type StremioMeta } from '../../../src/modules/stremio/catalog.service.js';

// Diagnostic harness: cost of enrichMetasWithCinemeta on a catalog page. Cinemeta is not
// subject to the upstream pacer; it is called directly with fetch and no timeout.

const CINEMETA_LATENCY_MS = 300; // assumed p50 for a Cinemeta meta call, to be checked against prod
const PAGE_SIZE = 100;
const ENRICH_CONCURRENCY = 10; // ENRICH_CONCURRENCY in src/modules/stremio/catalog.service.ts

let cinemetaCalls = 0;

const cinemetaHandler = http.get('https://v3-cinemeta.strem.io/meta/movie/:id.json', async ({ params }) => {
  cinemetaCalls++;
  await delay(CINEMETA_LATENCY_MS);
  const id = String(params['id']).replace(/\.json$/, '');
  return HttpResponse.json({
    meta: {
      id,
      name: `Film ${id}`,
      year: '2020',
      releaseInfo: '2020',
      poster: 'https://img.example.com/p.jpg',
      background: 'https://img.example.com/b.jpg',
      description: 'desc',
      imdbRating: '7.1',
      runtime: '100 min',
    },
  });
});

const server = setupServer(cinemetaHandler);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

/** Build a page of metas for a given list, with unique IMDb IDs per list. */
function makePage(listIndex: number, size = PAGE_SIZE): StremioMeta[] {
  return Array.from({ length: size }, (_, i) => ({
    id: `tt${String(listIndex * 1000 + i).padStart(7, '0')}`,
    type: 'movie',
    name: `List ${listIndex} film ${i}`,
  })) as StremioMeta[];
}

describe('catalog enrichment latency (diagnostic)', () => {
  it('cold enrichment of a 100-film page: Cinemeta calls and wall-clock time', async () => {
    cinemetaCalls = 0;
    const page = makePage(1);
    const started = Date.now();
    await enrichMetasWithCinemeta(page);
    const elapsed = Date.now() - started;

    const floor = Math.ceil(PAGE_SIZE / ENRICH_CONCURRENCY) * CINEMETA_LATENCY_MS;
    console.log(`[HARNESS-ENRICH] cold: cinemetaCalls=${cinemetaCalls} elapsed=${elapsed}ms floor=${floor}ms`);

    expect(cinemetaCalls).toBe(PAGE_SIZE);
    expect(elapsed).toBeGreaterThanOrEqual(floor * 0.9);
  }, 60_000);

  it('warm enrichment of the same page: served from cinemetaCache', async () => {
    cinemetaCalls = 0;
    const started = Date.now();
    await enrichMetasWithCinemeta(makePage(1));
    const elapsed = Date.now() - started;

    console.log(`[HARNESS-ENRICH] warm: cinemetaCalls=${cinemetaCalls} elapsed=${elapsed}ms`);

    expect(cinemetaCalls).toBe(0);
  }, 60_000);

  it('three distinct 100-film pages do not evict the first one', async () => {
    cinemetaCalls = 0;
    for (const n of [2, 3, 4]) await enrichMetasWithCinemeta(makePage(n));
    const callsForThree = cinemetaCalls;

    cinemetaCalls = 0;
    await enrichMetasWithCinemeta(makePage(1));
    const callsForFirstAgain = cinemetaCalls;

    console.log(
      `[HARNESS-ENRICH] thrash: calls for 3 new pages=${callsForThree}, ` +
        `first page re-fetched=${callsForFirstAgain} ` +
        `(cinemetaCache max=5000, cinemetaRawCache max=2000)`,
    );

    // Regression guard: with cinemetaCache at 200 entries, inserting pages 2..4 (300 ids)
    // evicted page 1 and forced a full refetch. The cache must outlive a handful of pages.
    expect(callsForThree).toBe(300);
    expect(callsForFirstAgain).toBe(0);
  }, 120_000);
});
