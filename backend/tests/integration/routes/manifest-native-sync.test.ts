import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { createUser, updateUserPreferences } from '../../../src/db/repositories/user.repository.js';

vi.mock('../../../src/modules/stremio/catalog/catalog-fetcher.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/modules/stremio/catalog/catalog-fetcher.service.js')>();
  return { ...actual, fetchUserLists: vi.fn().mockResolvedValue([]) };
});

const getEntitlement = vi.fn<(userId: string) => Promise<boolean>>();
vi.mock('../../../src/modules/billing/billing.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/modules/billing/billing.service.js')>();
  return { ...actual, getEntitlement: (userId: string) => getEntitlement(userId) };
});

const base = {
  catalogs: { watchlist: true, diary: false, friends: false, popular: false, top250: false, likedFilms: false, recommended: false },
  ownLists: [],
  externalLists: [],
};

function resourceNames(body: { resources: Array<string | { name: string }> }): string[] {
  return body.resources.map((r) => (typeof r === 'string' ? r : r.name));
}

describe('manifest: native sync resources', () => {
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

  beforeEach(() => getEntitlement.mockReset());

  async function manifestFor(nativeSync: boolean | undefined, entitled: boolean) {
    const user = createUser({ letterboxdId: `lb-${Math.random()}`, letterboxdUsername: 'nsm', refreshToken: 'fake' });
    updateUserPreferences(user.id, { ...base, ...(nativeSync === undefined ? {} : { nativeSync }) });
    getEntitlement.mockResolvedValue(entitled);
    const res = await app.inject({ method: 'GET', url: `/stremio/${user.id}/manifest.json` });
    return res.json();
  }

  it('declares player and library for an opted-in supporter, movies with tt ids only', async () => {
    const body = await manifestFor(true, true);
    expect(body.resources).toEqual(
      expect.arrayContaining([
        { name: 'player', types: ['movie'], idPrefixes: ['tt'] },
        { name: 'library', types: ['movie'], idPrefixes: ['tt'] },
      ]),
    );
  });

  it('declares nothing for a supporter who did not opt in, without calling Polar', async () => {
    const body = await manifestFor(undefined, true);
    expect(resourceNames(body)).not.toContain('player');
    expect(getEntitlement).not.toHaveBeenCalled();
  });

  it('declares nothing for an opted-in member who is not a supporter', async () => {
    const body = await manifestFor(true, false);
    expect(resourceNames(body)).not.toContain('player');
    expect(resourceNames(body)).not.toContain('library');
  });
});
