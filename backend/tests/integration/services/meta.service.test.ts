import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import { initDb, closeDb } from '../../../src/db/index.js';
import { cinemetaCache, imdbToLetterboxdCache, cinemetaRawCache } from '../../../src/lib/cache.js';
import { getFullFilmInfoFromCinemeta, getRawCinemetaMeta } from '../../../src/modules/stremio/meta.service.js';

const CINEMETA = 'https://v3-cinemeta.strem.io';

const cinemetaResponse = {
  meta: {
    name: 'Inception',
    year: '2010',
    releaseInfo: '2010',
    poster: 'https://img.example.com/inception.jpg',
    background: 'https://img.example.com/inception-bg.jpg',
    genres: ['Action', 'Sci-Fi'],
    director: ['Christopher Nolan'],
    cast: ['Leonardo DiCaprio', 'Tom Hardy'],
    writer: ['Christopher Nolan'],
    runtime: '148 min',
    description: 'A mind-bending thriller.',
    imdbRating: '8.8',
    trailers: [{ source: 'yt123', type: 'Trailer' }],
  },
};

const server = setupServer(
  http.get(`${CINEMETA}/meta/movie/:id.json`, () =>
    HttpResponse.json(cinemetaResponse),
  ),
);

describe('meta service', () => {
  beforeAll(() => {
    initDb();
    server.listen({ onUnhandledRequest: 'bypass' });
  });

  afterAll(() => {
    server.close();
    closeDb();
  });

  afterEach(() => {
    server.resetHandlers();
  });

  describe('getFullFilmInfoFromCinemeta', () => {
    it('fetches and returns structured cinemeta data', async () => {
      cinemetaCache.delete('tt1375666');
      cinemetaRawCache.delete('tt1375666');

      const result = await getFullFilmInfoFromCinemeta('tt1375666');

      expect(result).not.toBeNull();
      expect(result!.name).toBe('Inception');
      expect(result!.year).toBe(2010);
      expect(result!.description).toBe('A mind-bending thriller.');
      expect(result!.imdbRating).toBe('8.8');
      expect(result!.director).toEqual(['Christopher Nolan']);
      expect(result!.trailers).toHaveLength(1);
    });

    it('returns cached data on second call without re-fetching', async () => {
      cinemetaCache.delete('tt1375667');
      cinemetaRawCache.delete('tt1375667');

      await getFullFilmInfoFromCinemeta('tt1375667');

      // Replace handler with 500 — should still return cached
      server.use(
        http.get(`${CINEMETA}/meta/movie/tt1375667.json`, () =>
          HttpResponse.json({}, { status: 500 }),
        ),
      );

      const result = await getFullFilmInfoFromCinemeta('tt1375667');
      expect(result).not.toBeNull();
      expect(result!.name).toBe('Inception');
    });

    it('returns null when API returns error', async () => {
      server.use(
        http.get(`${CINEMETA}/meta/movie/tt0000000.json`, () =>
          HttpResponse.json({}, { status: 404 }),
        ),
      );

      const result = await getFullFilmInfoFromCinemeta('tt0000000');
      expect(result).toBeNull();
    });

    it('returns null when meta has no name', async () => {
      server.use(
        http.get(`${CINEMETA}/meta/movie/tt0000001.json`, () =>
          HttpResponse.json({ meta: { year: '2020' } }),
        ),
      );

      const result = await getFullFilmInfoFromCinemeta('tt0000001');
      expect(result).toBeNull();
    });
  });

  describe('getRawCinemetaMeta', () => {
    it('returns the raw meta object without field filtering', async () => {
      cinemetaRawCache.delete('tt1375668');

      const result = await getRawCinemetaMeta('tt1375668');

      expect(result).not.toBeNull();
      expect(result!['name']).toBe('Inception');
      expect(result!['imdbRating']).toBe('8.8');
    });
  });

  describe('cache interactions', () => {
    it('cinemetaCache stores and retrieves film data', () => {
      cinemetaCache.set('tt0111161', {
        name: 'The Shawshank Redemption',
        year: 1994,
        poster: 'https://example.com/poster.jpg',
        description: 'A great film',
        genres: ['Drama'],
        imdbRating: '9.3',
      });

      const cached = cinemetaCache.get('tt0111161');
      expect(cached).toBeDefined();
      expect(cached!.name).toBe('The Shawshank Redemption');

      cinemetaCache.delete('tt0111161');
    });

    it('imdbToLetterboxdCache maps IMDb to Letterboxd IDs', () => {
      imdbToLetterboxdCache.set('tt0111161', 'shawshank-redemption');
      expect(imdbToLetterboxdCache.get('tt0111161')).toBe('shawshank-redemption');
      imdbToLetterboxdCache.delete('tt0111161');
    });

    it('different IMDb IDs are isolated', () => {
      imdbToLetterboxdCache.set('tt2222', 'lbxd-222');
      imdbToLetterboxdCache.set('tt3333', 'lbxd-333');

      expect(imdbToLetterboxdCache.get('tt2222')).toBe('lbxd-222');
      expect(imdbToLetterboxdCache.get('tt3333')).toBe('lbxd-333');

      imdbToLetterboxdCache.delete('tt2222');
      imdbToLetterboxdCache.delete('tt3333');
    });
  });
});
