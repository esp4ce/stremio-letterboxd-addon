import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/lib/polar.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/polar.js')>();
  return { ...actual, getCustomerState: vi.fn() };
});

import { getCustomerState, PolarApiError } from '../../../src/lib/polar.js';
import { getEntitlementStatus, clearEntitlementCache } from '../../../src/modules/billing/billing.service.js';

const mockedState = vi.mocked(getCustomerState);
const ACTIVE = { active_subscriptions: [{ status: 'active' }], granted_benefits: [] };
const NONE = { active_subscriptions: [], granted_benefits: [] };

describe('getEntitlementStatus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    clearEntitlementCache();
    mockedState.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('a genuinely fresh not-entitled answer is trustworthy', async () => {
    mockedState.mockResolvedValue(NONE);

    const status = await getEntitlementStatus('u1', { fresh: true });

    expect(status).toEqual({ entitled: false, trustworthy: true });
  });

  it('a genuinely fresh entitled answer is trustworthy', async () => {
    mockedState.mockResolvedValue(ACTIVE);

    const status = await getEntitlementStatus('u1');

    expect(status).toEqual({ entitled: true, trustworthy: true });
  });

  it('a cache hit within the TTL stays trustworthy', async () => {
    mockedState.mockResolvedValue(ACTIVE);

    await getEntitlementStatus('u1');
    vi.advanceTimersByTime(9 * 60 * 1000);
    const status = await getEntitlementStatus('u1');

    expect(status).toEqual({ entitled: true, trustworthy: true });
    expect(mockedState).toHaveBeenCalledTimes(1);
  });

  it('a Polar failure with nothing cached is NOT trustworthy (unknown, not a real no)', async () => {
    mockedState.mockRejectedValue(new PolarApiError('customer state lookup', 503));

    const status = await getEntitlementStatus('u1');

    expect(status).toEqual({ entitled: false, trustworthy: false });
  });

  it('a Polar failure with a stale cached value falls back but stays untrustworthy', async () => {
    mockedState.mockResolvedValueOnce(ACTIVE).mockRejectedValueOnce(new Error('timeout'));

    await getEntitlementStatus('u1');
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    const status = await getEntitlementStatus('u1', { fresh: true });

    // Falls back to the last known value (true) so the feature gate itself
    // doesn't flip, but this is explicitly NOT a fresh Polar "yes" or "no".
    expect(status).toEqual({ entitled: true, trustworthy: false });
  });

  it('an untrustworthy cached value stays untrustworthy on a throttled repeat call', async () => {
    mockedState.mockRejectedValue(new Error('timeout'));

    await getEntitlementStatus('u1');
    vi.advanceTimersByTime(2 * 1000);
    const status = await getEntitlementStatus('u1');

    expect(status).toEqual({ entitled: false, trustworthy: false });
    expect(mockedState).toHaveBeenCalledTimes(1);
  });

  it('a subsequent successful call restores trustworthiness', async () => {
    mockedState.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce(NONE);

    const degraded = await getEntitlementStatus('u1');
    expect(degraded).toEqual({ entitled: false, trustworthy: false });

    vi.advanceTimersByTime(6 * 1000);
    const recovered = await getEntitlementStatus('u1', { fresh: true });
    expect(recovered).toEqual({ entitled: false, trustworthy: true });
  });
});
