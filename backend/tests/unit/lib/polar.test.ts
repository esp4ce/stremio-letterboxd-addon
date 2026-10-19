import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../../helpers/msw-server.js';
import {
  countFounderSeatsSold,
  createCheckout,
  createPortalUrl,
  getCustomerState,
  PolarApiError,
} from '../../../src/lib/polar.js';

const POLAR = 'https://sandbox-api.polar.sh';

describe('polar client', () => {
  beforeAll(() => mswServer.listen({ onUnhandledFrame: 'bypass' }));
  afterEach(() => mswServer.resetHandlers());
  afterAll(() => mswServer.close());

  describe('createCheckout', () => {
    it('sends both products, the session user as external customer, and the embed origin', async () => {
      let sentBody: Record<string, unknown> | undefined;
      let sentAuth: string | null = null;
      mswServer.use(
        http.post(`${POLAR}/v1/checkouts/`, async ({ request }) => {
          sentBody = (await request.json()) as Record<string, unknown>;
          sentAuth = request.headers.get('authorization');
          return HttpResponse.json({ url: 'https://sandbox.polar.sh/checkout/abc' }, { status: 201 });
        }),
      );

      const url = await createCheckout({ userId: 'user-1', email: 'a@b.c' });

      expect(url).toBe('https://sandbox.polar.sh/checkout/abc');
      expect(sentAuth).toBe('Bearer test-polar-token');
      expect(sentBody).toEqual({
        products: ['prod-yearly', 'prod-monthly'],
        external_customer_id: 'user-1',
        customer_email: 'a@b.c',
        success_url: 'http://localhost:3000/configure?checkout=success',
        embed_origin: 'http://localhost:3000',
      });
    });

    it('omits customer_email when unknown', async () => {
      let sentBody: Record<string, unknown> | undefined;
      mswServer.use(
        http.post(`${POLAR}/v1/checkouts/`, async ({ request }) => {
          sentBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ url: 'https://sandbox.polar.sh/checkout/abc' }, { status: 201 });
        }),
      );

      await createCheckout({ userId: 'user-1' });

      expect(sentBody).not.toHaveProperty('customer_email');
    });

    it('throws PolarApiError on a non-2xx response', async () => {
      mswServer.use(http.post(`${POLAR}/v1/checkouts/`, () => HttpResponse.json({}, { status: 500 })));

      await expect(createCheckout({ userId: 'user-1' })).rejects.toBeInstanceOf(PolarApiError);
    });

    it('sells only the Founder product for the founder offer', async () => {
      let sentBody: Record<string, unknown> | undefined;
      mswServer.use(
        http.post(`${POLAR}/v1/checkouts/`, async ({ request }) => {
          sentBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ url: 'https://sandbox.polar.sh/checkout/f' }, { status: 201 });
        }),
      );
      await createCheckout({ userId: 'user-1', offer: 'founder' });
      expect(sentBody?.['products']).toEqual(['prod-founder']);
    });

    it('throws when the response does not match the expected shape', async () => {
      mswServer.use(http.post(`${POLAR}/v1/checkouts/`, () => HttpResponse.json({ nope: true }, { status: 201 })));

      await expect(createCheckout({ userId: 'user-1' })).rejects.toThrow();
    });
  });

  describe('createPortalUrl', () => {
    it('returns the customer portal URL for the external customer', async () => {
      let sentBody: Record<string, unknown> | undefined;
      mswServer.use(
        http.post(`${POLAR}/v1/customer-sessions/`, async ({ request }) => {
          sentBody = (await request.json()) as Record<string, unknown>;
          return HttpResponse.json({ customer_portal_url: 'https://sandbox.polar.sh/portal/xyz' }, { status: 201 });
        }),
      );

      const url = await createPortalUrl('user-1');

      expect(url).toBe('https://sandbox.polar.sh/portal/xyz');
      expect(sentBody).toEqual({ external_customer_id: 'user-1', return_url: 'http://localhost:3000/configure' });
    });

    it('returns null when Polar does not know the customer', async () => {
      mswServer.use(http.post(`${POLAR}/v1/customer-sessions/`, () => HttpResponse.json({}, { status: 404 })));

      expect(await createPortalUrl('user-1')).toBeNull();
    });
  });

  describe('getCustomerState', () => {
    it('returns the active subscriptions', async () => {
      mswServer.use(
        http.get(`${POLAR}/v1/customers/external/user-1/state`, () =>
          HttpResponse.json({
            id: 'cus_1',
            active_subscriptions: [{ status: 'active', product_id: 'prod-yearly', cancel_at_period_end: false }],
          }),
        ),
      );

      expect(await getCustomerState('user-1')).toEqual({ active_subscriptions: [{ status: 'active' }], granted_benefits: [] });
    });

    it('returns null on 404', async () => {
      mswServer.use(
        http.get(`${POLAR}/v1/customers/external/user-1/state`, () => HttpResponse.json({}, { status: 404 })),
      );

      expect(await getCustomerState('user-1')).toBeNull();
    });

    it('url-encodes the external id', async () => {
      let hitPath = '';
      mswServer.use(
        http.get(`${POLAR}/v1/customers/external/:id/state`, ({ request }) => {
          hitPath = new URL(request.url).pathname;
          return HttpResponse.json({ active_subscriptions: [] });
        }),
      );

      await getCustomerState('a/b');

      expect(hitPath).toBe('/v1/customers/external/a%2Fb/state');
    });

    it('throws PolarApiError on 5xx', async () => {
      mswServer.use(
        http.get(`${POLAR}/v1/customers/external/user-1/state`, () => HttpResponse.json({}, { status: 503 })),
      );

      await expect(getCustomerState('user-1')).rejects.toBeInstanceOf(PolarApiError);
    });
  
    it('keeps only benefit_id from each grant', async () => {
      mswServer.use(
        http.get(`${POLAR}/v1/customers/external/user-1/state`, () =>
          HttpResponse.json({
            email: 'never@kept.example',
            active_subscriptions: [],
            granted_benefits: [{ id: 'g1', benefit_id: 'benefit-founder', benefit_type: 'feature_flag', properties: {} }],
          }),
        ),
      );
      expect(await getCustomerState('user-1')).toEqual({
        active_subscriptions: [],
        granted_benefits: [{ benefit_id: 'benefit-founder' }],
      });
    });
  });

  describe('countFounderSeatsSold', () => {
    it('counts paid and partially refunded orders of the Founder product', async () => {
      let query: URLSearchParams | undefined;
      mswServer.use(
        http.get(`${POLAR}/v1/orders/`, ({ request }) => {
          query = new URL(request.url).searchParams;
          return HttpResponse.json({ items: [], pagination: { total_count: 7, max_page: 7 } });
        }),
      );
      expect(await countFounderSeatsSold()).toBe(7);
      expect(query?.get('product_id')).toBe('prod-founder');
      expect(query?.getAll('status')).toEqual(['paid', 'partially_refunded']);
      expect(query?.get('limit')).toBe('1');
    });
  });
});
