import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { signUserToken } from '../../../src/lib/jwt.js';
import { createUser } from '../../../src/db/repositories/user.repository.js';
import type { FastifyInstance } from 'fastify';

describe('auth routes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    initDb();
    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  describe('POST /auth/preferences', () => {
    it('returns 401 without a valid token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/preferences',
        payload: {
          userToken: 'invalid-token',
          preferences: {
            catalogs: {
              watchlist: true,
              diary: true,
              friends: true,
              popular: true,
              top250: true,
              likedFilms: false,
              recommended: true,
            },
            ownLists: [],
            externalLists: [],
          },
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it('returns 404 for valid token but nonexistent user', async () => {
      const token = await signUserToken({
        userId: 'nonexistent-user-id-1234567890ab',
        letterboxdId: 'lbxd-ghost',
        username: 'ghost',
      });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/preferences',
        payload: {
          userToken: token,
          preferences: {
            catalogs: {
              watchlist: true,
              diary: true,
              friends: true,
              popular: true,
              top250: true,
              likedFilms: false,
              recommended: true,
            },
            ownLists: [],
            externalLists: [],
          },
        },
      });

      expect(res.statusCode).toBe(404);
    });

    it('updates preferences for authenticated user', async () => {
      // Seed a test user
      const user = createUser({
        letterboxdId: 'prefs-test-user',
        letterboxdUsername: 'prefsuser',
        refreshToken: 'fake-refresh-token',
      });

      const token = await signUserToken({
        userId: user.id,
        letterboxdId: user.letterboxd_id,
        username: user.letterboxd_username,
      });

      const res = await app.inject({
        method: 'POST',
        url: '/auth/preferences',
        payload: {
          userToken: token,
          preferences: {
            catalogs: {
              watchlist: true,
              diary: false,
              friends: false,
              popular: true,
              top250: true,
              likedFilms: false,
              recommended: false,
            },
            ownLists: ['list1'],
            externalLists: [],
            showRatings: false,
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ success: true });
    });

    it('returns 400 for invalid preferences schema', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/auth/preferences',
        payload: {
          userToken: 'some-token',
          preferences: { invalid: true },
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });
});
