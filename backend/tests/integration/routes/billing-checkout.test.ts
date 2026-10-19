import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../../helpers/msw-server.js';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { createUser } from '../../../src/db/repositories/user.repository.js';
import { signUserToken } from '../../../src/lib/jwt.js';

// The email prefill refetches the profile; keep it offline and deterministic.
vi.mock('../../../src/modules/letterboxd/letterboxd.client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/modules/letterboxd/letterboxd.client.js')>();
  return {
    ...actual,
    refreshAccessToken: vi.fn().mockResolvedValue({ access_token: 'a', refresh_token: 'r', expires_in: 3600, token_type: 'Bearer' }),
    getCurrentUser: vi.fn().mockResolvedValue({ member: { id: 'm', username: 'u', displayName: null }, emailAddress: 'fan@example.com' }),
  };
});

const POLAR = 'https://sandbox-api.polar.sh';

async function bearerFor(letterboxdId: string) {
  const user = createUser({ letterboxdId, letterboxdUsername: letterboxdId, refreshToken: 'x' });
  const token = await signUserToken({ userId: user.id, letterboxdId: user.letterboxd_id, username: user.letterboxd_username });
  return { user, headers: { authorization: `Bearer ${token}` } };
}

describe('POST /billing/checkout', () => {
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
    const res = await app.inject({ method: 'POST', url: '/billing/checkout' });
    expect(res.statusCode).toBe(401);
  });

  it('creates a Polar checkout bound to the session user and returns its URL', async () => {
    let sentBody: Record<string, unknown> | undefined;
    mswServer.use(
      http.post(`${POLAR}/v1/checkouts/`, async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ url: 'https://sandbox.polar.sh/checkout/inject' }, { status: 201 });
      }),
    );
    const { user, headers } = await bearerFor('checkout-1');

    const res = await app.inject({
      method: 'POST',
      url: '/billing/checkout',
      headers,
      // A client-supplied user id must be ignored.
      payload: { userId: 'someone-else' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://sandbox.polar.sh/checkout/inject' });
    expect(sentBody).toMatchObject({
      external_customer_id: user.id,
      customer_email: 'fan@example.com',
      products: ['prod-yearly', 'prod-monthly'],
      embed_origin: 'http://localhost:3000',
    });
  });

  it('returns 502 when Polar fails', async () => {
    mswServer.use(http.post(`${POLAR}/v1/checkouts/`, () => HttpResponse.json({}, { status: 500 })));
    const { headers } = await bearerFor('checkout-2');

    const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers });

    expect(res.statusCode).toBe(502);
  });

  it('keeps the subscription checkout when no offer is sent', async () => {
    let sentBody: Record<string, unknown> | undefined;
    mswServer.use(
      http.post(`${POLAR}/v1/checkouts/`, async ({ request }) => {
        sentBody = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ url: 'https://sandbox.polar.sh/checkout/s' }, { status: 201 });
      }),
    );
    const { headers } = await bearerFor('checkout-offer-default');
    const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers });
    expect(res.statusCode).toBe(200);
    expect(sentBody?.['products']).toEqual(['prod-yearly', 'prod-monthly']);
  });

  it('opens a Founder checkout while seats remain', async () => {
    mswServer.use(
      http.get(`${POLAR}/v1/orders/`, () => HttpResponse.json({ items: [], pagination: { total_count: 19, max_page: 19 } })),
      http.post(`${POLAR}/v1/checkouts/`, () => HttpResponse.json({ url: 'https://sandbox.polar.sh/checkout/f' }, { status: 201 })),
    );
    const { headers } = await bearerFor('checkout-founder-ok');
    const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers, payload: { offer: 'founder' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ url: 'https://sandbox.polar.sh/checkout/f' });
  });

  it('refuses a Founder checkout once 20 seats are sold, without creating one', async () => {
    let checkoutCalled = false;
    mswServer.use(
      http.get(`${POLAR}/v1/orders/`, () => HttpResponse.json({ items: [], pagination: { total_count: 20, max_page: 20 } })),
      http.post(`${POLAR}/v1/checkouts/`, () => {
        checkoutCalled = true;
        return HttpResponse.json({ url: 'https://x' }, { status: 201 });
      }),
    );
    const { headers } = await bearerFor('checkout-founder-full');
    const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers, payload: { offer: 'founder' } });
    expect(res.statusCode).toBe(410);
    expect(checkoutCalled).toBe(false);
  });

  it('rejects an unknown offer', async () => {
    const { headers } = await bearerFor('checkout-offer-bad');
    const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers, payload: { offer: 'lifetime' } });
    expect(res.statusCode).toBe(400);
  });

  it('returns 502 when the seat count fails', async () => {
    mswServer.use(http.get(`${POLAR}/v1/orders/`, () => HttpResponse.json({}, { status: 500 })));
    const { headers } = await bearerFor('checkout-founder-err');
    const res = await app.inject({ method: 'POST', url: '/billing/checkout', headers, payload: { offer: 'founder' } });
    expect(res.statusCode).toBe(502);
  });
});
