import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../../helpers/msw-server.js';
import { buildApp } from '../../../src/app.js';
import { initDb, closeDb } from '../../../src/db/index.js';
import { clearOfferCache } from '../../../src/modules/billing/billing.service.js';

const POLAR = 'https://sandbox-api.polar.sh';
const count = (n: number) => HttpResponse.json({ items: [], pagination: { total_count: n, max_page: n } });

describe('GET /billing/offer', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    mswServer.listen({ onUnhandledRequest: 'bypass' });
    initDb();
    app = await buildApp();
    await app.ready();
  });

  afterEach(() => {
    mswServer.resetHandlers();
    clearOfferCache();
  });

  afterAll(async () => {
    await app.close();
    closeDb();
    mswServer.close();
  });

  it('says the Founder offer is open without revealing how many seats are left', async () => {
    let subscriptionsRead = false;
    mswServer.use(
      http.get(`${POLAR}/v1/subscriptions/`, () => {
        subscriptionsRead = true;
        return count(18);
      }),
      http.get(`${POLAR}/v1/orders/`, () => count(3)),
    );
    const res = await app.inject({ method: 'GET', url: '/billing/offer' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ founderAvailable: true });
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(subscriptionsRead).toBe(false);
  });

  it('hides the Founder offer once all 20 seats are sold', async () => {
    mswServer.use(http.get(`${POLAR}/v1/orders/`, () => count(21)));
    const res = await app.inject({ method: 'GET', url: '/billing/offer' });
    expect(res.json()).toEqual({ founderAvailable: false });
  });

  it('degrades to closed, not a 500, when Polar refuses (e.g. missing scope)', async () => {
    mswServer.use(http.get(`${POLAR}/v1/orders/`, () => HttpResponse.json({}, { status: 403 })));
    const res = await app.inject({ method: 'GET', url: '/billing/offer' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ founderAvailable: false });
  });

  it('caches the answer instead of calling Polar on every request', async () => {
    let calls = 0;
    mswServer.use(
      http.get(`${POLAR}/v1/orders/`, () => {
        calls++;
        return count(0);
      }),
    );
    await app.inject({ method: 'GET', url: '/billing/offer' });
    await app.inject({ method: 'GET', url: '/billing/offer' });
    expect(calls).toBe(1);
  });
});
