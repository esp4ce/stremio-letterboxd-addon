import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../../helpers/msw-server.js';

// Injecte une clé API TMDB tout en gardant le vrai client (les requêtes passent par MSW).
vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/config/index.js')>();
  return { ...actual, tmdbConfig: { apiKey: 'test-api-key' } };
});

import { filterFilmsByReleaseData } from '../../../src/modules/stremio/catalog/release-filter.js';
import { imdbToTmdbCache, releaseDatesCache } from '../../../src/lib/cache.js';
import type { StremioMeta } from '../../../src/modules/stremio/catalog.service.js';

const TMDB = 'https://api.themoviedb.org/3';
const currentYear = new Date().getFullYear();
const future = new Date(Date.now() + 120 * 864e5).toISOString().slice(0, 10);

function meta(id: string, year?: number): StremioMeta {
  return { id, type: 'movie', name: id, year: year ?? 2019 };
}

beforeAll(() => mswServer.listen({ onUnhandledRequest: 'bypass' }));
afterEach(() => mswServer.resetHandlers());
afterAll(() => mswServer.close());
beforeEach(() => {
  imdbToTmdbCache.clear();
  releaseDatesCache.clear();
});

describe('filterFilmsByReleaseData (intégration MSW / TMDB)', () => {
  it('#77 — masque un film dont la sortie cinéma est future (même année)', async () => {
    mswServer.use(
      http.get(`${TMDB}/movie/:id/release_dates`, () =>
        HttpResponse.json({
          results: [{ iso_3166_1: 'US', release_dates: [{ type: 3, release_date: `${future}T00:00:00.000Z` }] }],
        }),
      ),
    );

    const out = await filterFilmsByReleaseData([meta('tt1', currentYear)], {
      hideUnreleased: true,
      hideNoHomeRelease: false,
    });

    expect(out).toHaveLength(0);
  });

  it('#90 — masque un film sans sortie home et garde celui qui en a une', async () => {
    mswServer.use(
      http.get(`${TMDB}/find/:externalId`, ({ params }) =>
        HttpResponse.json({ movie_results: [{ id: params['externalId'] === 'tt-home' ? 1 : 2 }] }),
      ),
      http.get(`${TMDB}/movie/:id/release_dates`, ({ params }) =>
        HttpResponse.json({
          results:
            params['id'] === '1'
              ? [{ iso_3166_1: 'FR', release_dates: [{ type: 4, release_date: '2020-05-01T00:00:00.000Z' }] }]
              : [{ iso_3166_1: 'US', release_dates: [{ type: 3, release_date: '2020-01-01T00:00:00.000Z' }] }],
        }),
      ),
    );

    const out = await filterFilmsByReleaseData([meta('tt-home'), meta('tt-nohome')], {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });

    expect(out.map((m) => m.id)).toEqual(['tt-home']);
  });

  it('TMDB indisponible (500) → aucun filtrage', async () => {
    mswServer.use(
      http.get(`${TMDB}/find/:externalId`, () => new HttpResponse(null, { status: 500 })),
    );

    const metas = [meta('tt1', 2019), meta('tt2', currentYear + 5)];
    const out = await filterFilmsByReleaseData(metas, {
      hideUnreleased: false,
      hideNoHomeRelease: true,
    });

    expect(out).toHaveLength(2);
  });
});
