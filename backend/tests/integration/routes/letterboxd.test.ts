import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { signUserToken } from '../../../src/lib/jwt.js';
import { createUser } from '../../../src/db/repositories/user.repository.js';
import { mswServer } from '../../helpers/msw-server.js';

vi.mock('../../../src/modules/letterboxd/letterboxd.service.js', () => ({
  resolveFilm: vi.fn(),
  getFilmRating: vi.fn(),
  parseLetterboxdListUrl: vi.fn(),
  resolveExternalList: vi.fn(),
}));

vi.mock('../../../src/modules/letterboxd/letterboxd.client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/modules/letterboxd/letterboxd.client.js')>();
  return {
    ...actual,
    refreshAccessToken: vi.fn().mockResolvedValue({
      access_token: 'test-access-token',
      refresh_token: 'test-refresh-token',
      expires_in: 3600,
      token_type: 'Bearer',
    }),
    createAuthenticatedClient: vi.fn().mockReturnValue({}),
  };
});

import * as letterboxdService from '../../../src/modules/letterboxd/letterboxd.service.js';

describe('letterboxd routes', () => {
  let app: FastifyInstance;
  let userToken: string;

  beforeAll(async () => {
    mswServer.listen({ onUnhandledRequest: 'bypass' });
    initDb();
    app = await buildApp();
    await app.ready();

    const user = createUser({
      letterboxdId: 'lbxd-routes-test',
      letterboxdUsername: 'routestestuser',
      refreshToken: 'fake-refresh-token',
    });

    userToken = await signUserToken({
      userId: user.id,
      letterboxdId: user.letterboxd_id,
      username: user.letterboxd_username,
    });
  });

  afterAll(async () => {
    mswServer.close();
    await app.close();
    closeDb();
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /v1/resolve-film', () => {
    it('retourne 401 sans header Authorization', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/resolve-film?title=Inception',
      });
      expect(res.statusCode).toBe(401);
    });

    it('retourne 401 avec un token invalide', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/resolve-film?title=Inception',
        headers: { authorization: 'Bearer invalid-token' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('retourne 400 si aucun critère de recherche fourni', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/resolve-film',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it("retourne 404 si le film n'est pas trouvé", async () => {
      vi.mocked(letterboxdService.resolveFilm).mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/resolve-film?title=FilmInexistant',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(404);
    });

    it('retourne 200 avec les données du film', async () => {
      vi.mocked(letterboxdService.resolveFilm).mockResolvedValue({
        id: 'film-abc',
        name: 'Inception',
        releaseYear: 2010,
        poster: 'https://ltrbxd.com/poster.jpg',
        imdbId: 'tt1375666',
        tmdbId: '27205',
      });

      const res = await app.inject({
        method: 'GET',
        url: '/v1/resolve-film?title=Inception',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: 'film-abc', name: 'Inception', imdbId: 'tt1375666' });
    });
  });

  describe('GET /v1/film-rating', () => {
    it('retourne 401 sans header Authorization', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/film-rating?filmId=film-abc',
      });
      expect(res.statusCode).toBe(401);
    });

    it('retourne 400 si filmId manquant', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/film-rating',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(400);
    });

    it('retourne 200 avec les données de rating', async () => {
      vi.mocked(letterboxdService.getFilmRating).mockResolvedValue({
        rating: 4.2,
        watched: true,
        liked: true,
        inWatchlist: false,
        globalRating: 3.8,
        watchCount: 100,
      } as never);

      const res = await app.inject({
        method: 'GET',
        url: '/v1/film-rating?filmId=film-abc',
        headers: { authorization: `Bearer ${userToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ rating: 4.2, watched: true });
    });
  });

  describe('POST /letterboxd/resolve-list', () => {
    it('retourne 401 avec un token invalide', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/letterboxd/resolve-list',
        payload: { userToken: 'invalid', url: 'https://letterboxd.com/user/list/my-list/' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('retourne 400 pour une URL non-list', async () => {
      vi.mocked(letterboxdService.parseLetterboxdListUrl).mockReturnValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/letterboxd/resolve-list',
        payload: { userToken, url: 'https://example.com/not-a-list' },
      });
      expect(res.statusCode).toBe(400);
    });

    it("retourne 404 si la liste n'existe pas", async () => {
      vi.mocked(letterboxdService.parseLetterboxdListUrl).mockReturnValue({
        username: 'testuser',
        slug: 'my-list',
      });
      vi.mocked(letterboxdService.resolveExternalList).mockResolvedValue(null);

      const res = await app.inject({
        method: 'POST',
        url: '/letterboxd/resolve-list',
        payload: { userToken, url: 'https://letterboxd.com/testuser/list/my-list/' },
      });
      expect(res.statusCode).toBe(404);
    });

    it('retourne 200 avec les données de la liste', async () => {
      vi.mocked(letterboxdService.parseLetterboxdListUrl).mockReturnValue({
        username: 'testuser',
        slug: 'my-cool-list',
      });
      vi.mocked(letterboxdService.resolveExternalList).mockResolvedValue({
        id: 'list-abc',
        name: 'My Cool List',
        owner: 'Test User',
        filmCount: 25,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/letterboxd/resolve-list',
        payload: { userToken, url: 'https://letterboxd.com/testuser/list/my-cool-list/' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ id: 'list-abc', name: 'My Cool List', filmCount: 25 });
    });
  });
});
