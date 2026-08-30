import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import {
  createUser,
  updateUserPreferences,
  type UserPreferences,
} from '../../../src/db/repositories/user.repository.js';

vi.mock('../../../src/modules/stremio/user-client.service.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../src/modules/stremio/user-client.service.js')>();
  return { ...actual, createClientForUser: vi.fn() };
});

vi.mock('../../../src/modules/stremio/catalog/public-catalog-fetcher.service.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../src/modules/stremio/catalog/public-catalog-fetcher.service.js')
  >();
  return { ...actual, fetchListCatalogPublic: vi.fn() };
});

import { createClientForUser, SessionExpiredError } from '../../../src/modules/stremio/user-client.service.js';
import { fetchListCatalogPublic } from '../../../src/modules/stremio/catalog/public-catalog-fetcher.service.js';

const mockedCreateClient = vi.mocked(createClientForUser);
const mockedPublicList = vi.mocked(fetchListCatalogPublic);

const PUBLIC_LIST_META = { id: 'tt1375666', type: 'movie' as const, name: 'Inception', year: 2010 };

const basePreferences: UserPreferences = {
  catalogs: {
    watchlist: true,
    diary: true,
    friends: true,
    popular: true,
    top250: true,
    likedFilms: true,
    recommended: true,
  },
  ownLists: [],
  externalLists: [{ id: 'list-1', name: 'Public Picks', owner: 'someone', filmCount: 12 }],
};

describe('Full Mode session isolation', () => {
  let app: FastifyInstance;
  let userId: string;

  beforeAll(async () => {
    initDb();
    app = await buildApp();
    await app.ready();

    const user = createUser({
      letterboxdId: 'session-iso-member',
      letterboxdUsername: 'sessioniso',
      letterboxdDisplayName: 'Session Iso',
      refreshToken: 'fake-refresh-token',
    });
    userId = user.id;
    updateUserPreferences(userId, basePreferences);
  });

  afterEach(() => {
    mockedCreateClient.mockReset();
    mockedPublicList.mockReset();
  });

  afterAll(async () => {
    await app.close();
    closeDb();
  });

  it('serves a public custom list without touching the user session', async () => {
    mockedCreateClient.mockRejectedValue(new SessionExpiredError(userId));
    mockedPublicList.mockResolvedValue({ metas: [PUBLIC_LIST_META] });

    const res = await app.inject({
      method: 'GET',
      url: `/stremio/${userId}/catalog/movie/letterboxd-list-list-1.json`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().metas[0].id).toBe('tt1375666');
    expect(mockedPublicList).toHaveBeenCalledWith('list-1', 0, expect.anything(), undefined, undefined, undefined);
    expect(mockedCreateClient).not.toHaveBeenCalled();
  });

  it('falls back to the user session when the public list fetch fails', async () => {
    mockedPublicList.mockRejectedValue(new Error('private list'));
    mockedCreateClient.mockRejectedValue(new SessionExpiredError(userId));

    const res = await app.inject({
      method: 'GET',
      url: `/stremio/${userId}/catalog/movie/letterboxd-list-list-1.json`,
    });

    // Public fetch failed, the authenticated fallback also fails on the expired session.
    expect(res.json().metas[0].id).toBe('letterboxd-session-expired');
    expect(mockedCreateClient).toHaveBeenCalled();
  });

  it('still shows the reconnect prompt for auth-only catalogs when the session expired', async () => {
    mockedCreateClient.mockRejectedValue(new SessionExpiredError(userId));

    const res = await app.inject({
      method: 'GET',
      url: `/stremio/${userId}/catalog/movie/letterboxd-diary.json`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().metas[0].id).toBe('letterboxd-session-expired');
  });

  it('keeps external list catalogs in the manifest when the session expired', async () => {
    mockedCreateClient.mockRejectedValue(new SessionExpiredError(userId));

    const res = await app.inject({
      method: 'GET',
      url: `/stremio/${userId}/manifest.json`,
    });

    expect(res.statusCode).toBe(200);
    const ids = res.json().catalogs.map((c: { id: string }) => c.id);
    expect(ids).toContain('letterboxd-list-list-1');
  });
});
