import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import {
  findFilmByImdb,
  externalIdLookupBreaker,
  EXTERNAL_ID_FAILURE_THRESHOLD,
} from '../../../src/modules/stremio/meta.service.js';
import { filmLookupCache, imdbToLetterboxdCache, cinemetaCache, cinemetaRawCache } from '../../../src/lib/cache.js';

// Regression guard for the catalog-latency diagnosis: in production every external-ID
// lookup answered 404 (160 of 160) and only the search path ever resolved a film, so each
// lookup burned one upstream call for nothing. Once it is seen failing, later lookups
// must skip it.

const cinemetaHandler = http.get('https://v3-cinemeta.strem.io/meta/movie/:id.json', ({ params }) => {
  const id = String(params['id']).replace(/\.json$/, '');
  return HttpResponse.json({ meta: { id, name: 'Found Film', year: '2020', releaseInfo: '2020' } });
});

const server = setupServer(cinemetaHandler);

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

interface Calls {
  external: number;
  search: number;
}

/** Minimal stand-in for the authenticated client, counting upstream calls. */
function makeClient(opts: { externalResolves: boolean }) {
  const calls: Calls = { external: 0, search: 0 };
  const client = {
    async getFilmByExternalId() {
      calls.external++;
      // Production behaviour under the incident: the endpoint answers "not found".
      return opts.externalResolves ? { id: 'LBEXT', name: 'Found Film', releaseYear: 2020 } : null;
    },
    async searchFilms() {
      calls.search++;
      return { items: [{ id: 'LBSEARCH', name: 'Found Film', releaseYear: 2020 }] };
    },
    async getFilmByLid() {
      return { id: 'LBLID', name: 'Found Film', releaseYear: 2020 };
    },
  };
  return { client: client as never, calls };
}

beforeEach(() => {
  filmLookupCache.clear();
  imdbToLetterboxdCache.clear();
  cinemetaCache.clear();
  cinemetaRawCache.clear();
  externalIdLookupBreaker.reset();
});

describe('findFilmByImdb upstream call budget', () => {
  it('resolves via the search path when the external-ID endpoint finds nothing', async () => {
    const { client, calls } = makeClient({ externalResolves: false });
    const result = await findFilmByImdb(client, 'tt0000001');

    expect(result?.letterboxdFilmId).toBe('LBSEARCH');
    expect(calls.external).toBe(1);
    expect(calls.search).toBe(1);
  });

  it('stops calling the external-ID endpoint after repeated failures', async () => {
    const { client, calls } = makeClient({ externalResolves: false });

    for (let i = 0; i < EXTERNAL_ID_FAILURE_THRESHOLD; i++) {
      await findFilmByImdb(client, `tt100000${i}`);
    }
    const externalAfterWarmup = calls.external;
    expect(externalAfterWarmup).toBe(EXTERNAL_ID_FAILURE_THRESHOLD);

    // Breaker is open now: the next lookups must go straight to the search path.
    await findFilmByImdb(client, 'tt2000001');
    await findFilmByImdb(client, 'tt2000002');

    expect(calls.external).toBe(externalAfterWarmup); // no further wasted calls
    expect(calls.search).toBe(EXTERNAL_ID_FAILURE_THRESHOLD + 2);
  });

  it('keeps using the external-ID endpoint while it resolves films', async () => {
    const { client, calls } = makeClient({ externalResolves: true });

    for (let i = 0; i < EXTERNAL_ID_FAILURE_THRESHOLD + 3; i++) {
      const result = await findFilmByImdb(client, `tt300000${i}`);
      expect(result?.letterboxdFilmId).toBe('LBEXT');
    }

    expect(calls.external).toBe(EXTERNAL_ID_FAILURE_THRESHOLD + 3);
    expect(calls.search).toBe(0);
  });

  it('serves a repeated lookup from cache without any upstream call', async () => {
    const { client, calls } = makeClient({ externalResolves: false });
    await findFilmByImdb(client, 'tt0000009');
    const before = { ...calls };

    await findFilmByImdb(client, 'tt0000009');

    expect(calls.external).toBe(before.external);
    expect(calls.search).toBe(before.search);
  });
});
