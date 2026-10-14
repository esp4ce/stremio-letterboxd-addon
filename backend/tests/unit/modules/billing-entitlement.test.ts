import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/lib/polar.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/lib/polar.js')>();
  return { ...actual, getCustomerState: vi.fn() };
});

import { getCustomerState, PolarApiError } from '../../../src/lib/polar.js';
import { getEntitlement, clearEntitlementCache } from '../../../src/modules/billing/billing.service.js';

const mockedState = vi.mocked(getCustomerState);
const ACTIVE = { active_subscriptions: [{ status: 'active' }], granted_benefits: [] };
const NONE = { active_subscriptions: [], granted_benefits: [] };

describe('getEntitlement', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    clearEntitlementCache();
    mockedState.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks Polar once, then serves the cached value within 10 minutes', async () => {
    mockedState.mockResolvedValue(ACTIVE);

    expect(await getEntitlement('u1')).toBe(true);
    vi.advanceTimersByTime(9 * 60 * 1000);
    expect(await getEntitlement('u1')).toBe(true);

    expect(mockedState).toHaveBeenCalledTimes(1);
  });

  it('refetches once the 10-minute TTL has passed', async () => {
    mockedState.mockResolvedValueOnce(ACTIVE).mockResolvedValueOnce(NONE);

    expect(await getEntitlement('u1')).toBe(true);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(await getEntitlement('u1')).toBe(false);

    expect(mockedState).toHaveBeenCalledTimes(2);
  });

  it('caches a not-found customer as not entitled', async () => {
    mockedState.mockResolvedValue(null);

    expect(await getEntitlement('u1')).toBe(false);
    expect(await getEntitlement('u1')).toBe(false);

    expect(mockedState).toHaveBeenCalledTimes(1);
  });

  it('fresh bypasses the TTL', async () => {
    mockedState.mockResolvedValueOnce(NONE).mockResolvedValueOnce(ACTIVE);

    expect(await getEntitlement('u1')).toBe(false);
    vi.advanceTimersByTime(6 * 1000);
    expect(await getEntitlement('u1', { fresh: true })).toBe(true);
  });

  it('fresh does not call Polar again within 5 seconds of the last call', async () => {
    mockedState.mockResolvedValue(NONE);

    await getEntitlement('u1', { fresh: true });
    vi.advanceTimersByTime(4 * 1000);
    await getEntitlement('u1', { fresh: true });

    expect(mockedState).toHaveBeenCalledTimes(1);
  });

  it('keeps the last known value when Polar fails', async () => {
    mockedState.mockResolvedValueOnce(ACTIVE).mockRejectedValueOnce(new PolarApiError('customer state lookup', 503));

    expect(await getEntitlement('u1')).toBe(true);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(await getEntitlement('u1')).toBe(true);
  });

  it('fails closed when Polar fails and nothing is cached', async () => {
    mockedState.mockRejectedValue(new Error('timeout'));

    expect(await getEntitlement('u1')).toBe(false);
  });

  it('does not hammer Polar during an outage', async () => {
    mockedState.mockRejectedValue(new Error('timeout'));

    await getEntitlement('u1');
    vi.advanceTimersByTime(2 * 1000);
    await getEntitlement('u1');

    expect(mockedState).toHaveBeenCalledTimes(1);
  });

  it('keys the cache per user', async () => {
    mockedState.mockImplementation(async (userId) => (userId === 'u1' ? ACTIVE : NONE));

    expect(await getEntitlement('u1')).toBe(true);
    expect(await getEntitlement('u2')).toBe(false);
  });
});
