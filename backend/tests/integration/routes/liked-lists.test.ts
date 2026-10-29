import { describe, it, expect, beforeAll, afterAll, afterEach, beforeEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { http, HttpResponse } from 'msw';
import { configure } from '@esp4ce/letterboxd-client';
import { mswServer, makeList, makeMember } from '../../helpers/msw-server.js';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { createUser } from '../../../src/db/repositories/user.repository.js';
import { signUserToken } from '../../../src/lib/jwt.js';
import { catalogConfig } from '../../../src/config/index.js';

const getEntitlement = vi.fn<(userId: string) => Promise<boolean>>();
vi.mock('../../../src/modules/billing/billing.service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/modules/billing/billing.service.js')>();
  return { ...actual, getEntitlement: (userId: string) => getEntitlement(userId) };
});

async function bearerFor(letterboxdId: string) {
  const user = createUser({ letterboxdId, letterboxdUsername: letterboxdId, refreshToken: 'x' });
  const token = await signUserToken({ userId: user.id, letterboxdId: user.letterboxd_id, username: user.letterboxd_username });
  return { user, headers: { authorization: `Bearer ${token}` } };
}

describe('GET /auth/liked-lists', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    configure({ clientId: catalogConfig.clientId, clientSecret: catalogConfig.clientSecret, userAgent: catalogConfig.userAgent });
    mswServer.listen({ onUnhandledRequest: 'error' });
    initDb();
    app = await buildApp();
    await app.ready();
  });

  beforeEach(() => {
    getEntitlement.mockReset();
    mswServer.use(
      http.all('*/auth/token', () =>
        HttpResponse.json({ access_token: 'test-access-token', token_type: 'Bearer', expires_in: 3600, refresh_token: 'test-refresh-token' }),
      ),
    );
  });
  afterEach(() => mswServer.resetHandlers());

  afterAll(async () => {
    await app.close();
    closeDb();
    mswServer.close();
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/liked-lists' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 NOT_ENTITLED for a member who is not a supporter, without calling upstream', async () => {
    let upstreamCalls = 0;
    mswServer.use(http.get('*/lists', () => { upstreamCalls++; return HttpResponse.json({ items: [] }); }));
    getEntitlement.mockResolvedValue(false);
    const { headers } = await bearerFor('liked-free');

    const res = await app.inject({ method: 'GET', url: '/auth/liked-lists', headers });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('NOT_ENTITLED');
    expect(upstreamCalls).toBe(0);
  });

  it('lists what the supporter liked, asking upstream for the Liked relationship of their own member id', async () => {
    let query: URLSearchParams | undefined;
    mswServer.use(
      http.get('*/lists', ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({
          items: [
            makeList({ id: 'L1', name: 'Best Heists', filmCount: 42, owner: makeMember({ username: 'alice', displayName: 'Alice' }) }),
            makeList({ id: 'L2', name: 'Slow Burns', filmCount: 7, owner: makeMember({ username: 'bob', displayName: 'Bob' }) }),
          ],
          next: 'start=2',
        });
      }),
    );
    getEntitlement.mockResolvedValue(true);
    const { headers } = await bearerFor('liked-paid');

    const res = await app.inject({ method: 'GET', url: '/auth/liked-lists', headers });

    expect(res.statusCode).toBe(200);
    expect(query?.get('member')).toBe('liked-paid');
    expect(query?.get('memberRelationship')).toBe('Liked');
    expect(res.json()).toEqual({
      items: [
        { id: 'L1', name: 'Best Heists', owner: 'Alice', filmCount: 42 },
        { id: 'L2', name: 'Slow Burns', owner: 'Bob', filmCount: 7 },
      ],
      cursor: 'start=2',
    });
  });

  it('forwards the pagination cursor upstream', async () => {
    let query: URLSearchParams | undefined;
    mswServer.use(
      http.get('*/lists', ({ request }) => {
        query = new URL(request.url).searchParams;
        return HttpResponse.json({ items: [] });
      }),
    );
    getEntitlement.mockResolvedValue(true);
    const { headers } = await bearerFor('liked-page');

    const res = await app.inject({ method: 'GET', url: '/auth/liked-lists?cursor=start%3D50', headers });

    expect(res.statusCode).toBe(200);
    expect(query?.get('cursor')).toBe('start=50');
    expect(res.json()).toEqual({ items: [], cursor: undefined });
  });
});
