import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../../helpers/msw-server.js';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { createUser } from '../../../src/db/repositories/user.repository.js';
import { signUserToken } from '../../../src/lib/jwt.js';

const POLAR = 'https://sandbox-api.polar.sh';

async function bearerFor(letterboxdId: string) {
  const user = createUser({ letterboxdId, letterboxdUsername: letterboxdId, refreshToken: 'x' });
  const token = await signUserToken({ userId: user.id, letterboxdId: user.letterboxd_id, username: user.letterboxd_username });
  return { user, headers: { authorization: `Bearer ${token}` } };
}

describe('GET /billing/portal', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    mswServer.listen({ onUnhandledFrame: 'bypass' });
    initDb();
    app = await buildApp();
    await app.ready();
  });

  afterEach(() => mswServer.resetHandlers());

  afterAll(async () => {
    await app.close();
    closeDb();
    mswServer.close();
  });

  it('returns 401 without a session', async () => {
    const res = await app.inject({ method: 'GET', url: '/billing/portal' });
    expect(res.statusCode).toBe(401);
  });

  it('redirects to the Polar customer portal for the session user', async () => {
    let sentBody: Record<string, unknown> | undefined;
    mswServer.use(
      http.post(`${POLAR}/v1/customer-sessions/`, async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ customer_portal_url: 'https://sandbox.polar.sh/portal/p1' }, { status: 201 });
      }),
    );
    const { user, headers } = await bearerFor('portal-1');

    const res = await app.inject({ method: 'GET', url: '/billing/portal', headers });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe('https://sandbox.polar.sh/portal/p1');
    expect(sentBody).toMatchObject({ external_customer_id: user.id });
  });

  it('returns 404 when Polar does not know the customer', async () => {
    mswServer.use(http.post(`${POLAR}/v1/customer-sessions/`, () => HttpResponse.json({}, { status: 404 })));
    const { headers } = await bearerFor('portal-2');

    const res = await app.inject({ method: 'GET', url: '/billing/portal', headers });

    expect(res.statusCode).toBe(404);
  });

  it('returns 502 when Polar fails', async () => {
    mswServer.use(http.post(`${POLAR}/v1/customer-sessions/`, () => HttpResponse.json({}, { status: 500 })));
    const { headers } = await bearerFor('portal-3');

    const res = await app.inject({ method: 'GET', url: '/billing/portal', headers });

    expect(res.statusCode).toBe(502);
  });
});
