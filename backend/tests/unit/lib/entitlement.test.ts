import { describe, it, expect } from 'vitest';
import { isSupporter } from '../../../src/lib/entitlement.js';

const state = (statuses: string[], benefitIds: string[] = []) => ({
  active_subscriptions: statuses.map((status) => ({ status })),
  granted_benefits: benefitIds.map((benefit_id) => ({ benefit_id })),
});

describe('isSupporter', () => {
  it('returns false when Polar does not know the customer', () => {
    expect(isSupporter(null)).toBe(false);
  });

  it('returns false with no subscription and no benefit', () => {
    expect(isSupporter(state([]))).toBe(false);
  });

  it('returns true for an active subscription (including one scheduled to cancel)', () => {
    expect(isSupporter(state(['active']))).toBe(true);
  });

  it('returns true for a trialing subscription', () => {
    expect(isSupporter(state(['trialing']))).toBe(true);
  });

  it('returns false for any other status', () => {
    expect(isSupporter(state(['past_due']))).toBe(false);
  });

  it('returns true for a Founder with no subscription', () => {
    expect(isSupporter(state([], ['benefit-founder']))).toBe(true);
  });

  it('ignores any other benefit', () => {
    expect(isSupporter(state([], ['benefit-something-else']))).toBe(false);
  });

  it('returns true for a Founder who still holds a lapsed subscription', () => {
    expect(isSupporter(state(['past_due'], ['benefit-founder']))).toBe(true);
  });
});
