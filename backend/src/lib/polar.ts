import { z } from 'zod';
import { requirePolarConfig } from '../config/index.js';

const POLAR_API_BASE = {
  production: 'https://api.polar.sh',
  sandbox: 'https://sandbox-api.polar.sh',
} as const;

const REQUEST_TIMEOUT_MS = 5000;

// Only the fields we actually read — Zod strips everything else.
const checkoutResponseSchema = z.object({ url: z.string().url() });
const customerSessionResponseSchema = z.object({ customer_portal_url: z.string().url() });
const customerStateResponseSchema = z.object({
  active_subscriptions: z.array(z.object({ status: z.string() })),
  // Founder access arrives as a benefit grant (ADR 0003); older or partial payloads may omit it.
  granted_benefits: z.array(z.object({ benefit_id: z.string() })).default([]),
});
const countResponseSchema = z.object({ pagination: z.object({ total_count: z.number().int().nonnegative() }) });

export type CustomerState = z.infer<typeof customerStateResponseSchema>;

export class PolarApiError extends Error {
  readonly status: number;

  constructor(operation: string, status: number) {
    // Status only: Polar response bodies are never copied into errors or logs.
    super(`Polar ${operation} failed with status ${status}`);
    this.name = 'PolarApiError';
    this.status = status;
  }
}

async function polarRequest(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response> {
  const polar = requirePolarConfig();
  return fetch(`${POLAR_API_BASE[polar.server]}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${polar.accessToken}`,
      Accept: 'application/json',
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

export type CheckoutOffer = 'supporter' | 'founder';

export async function createCheckout(params: { userId: string; email?: string; offer?: CheckoutOffer }): Promise<string> {
  const polar = requirePolarConfig();
  const frontend = new URL(polar.frontendUrl);
  const products = params.offer === 'founder' ? [polar.productIdFounder!] : [polar.productIdYearly, polar.productIdMonthly];

  const response = await polarRequest('POST', '/v1/checkouts/', {
    products,
    external_customer_id: params.userId,
    ...(params.email ? { customer_email: params.email } : {}),
    success_url: new URL('/configure?checkout=success', frontend).toString(),
    embed_origin: frontend.origin,
  });

  if (!response.ok) {
    throw new PolarApiError('checkout creation', response.status);
  }
  return checkoutResponseSchema.parse(await response.json()).url;
}

export async function createPortalUrl(userId: string): Promise<string | null> {
  const polar = requirePolarConfig();

  const response = await polarRequest('POST', '/v1/customer-sessions/', {
    external_customer_id: userId,
    return_url: new URL('/configure', polar.frontendUrl).toString(),
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new PolarApiError('customer session creation', response.status);
  }
  return customerSessionResponseSchema.parse(await response.json()).customer_portal_url;
}

export async function getCustomerState(userId: string): Promise<CustomerState | null> {
  const response = await polarRequest('GET', `/v1/customers/external/${encodeURIComponent(userId)}/state`);

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new PolarApiError('customer state lookup', response.status);
  }
  return customerStateResponseSchema.parse(await response.json());
}

async function polarCount(operation: string, path: string, params: [string, string][]): Promise<number> {
  const query = new URLSearchParams([...params, ['limit', '1']]);
  const response = await polarRequest('GET', `${path}?${query.toString()}`);
  if (!response.ok) {
    throw new PolarApiError(operation, response.status);
  }
  return countResponseSchema.parse(await response.json()).pagination.total_count;
}

/** Paid seats; a fully refunded order frees its seat. Callers must check isFounderConfigured first. */
export function countFounderSeatsSold(): Promise<number> {
  const { productIdFounder } = requirePolarConfig();
  return polarCount('founder order count', '/v1/orders/', [
    ['product_id', productIdFounder!],
    ['status', 'paid'],
    ['status', 'partially_refunded'],
  ]);
}
