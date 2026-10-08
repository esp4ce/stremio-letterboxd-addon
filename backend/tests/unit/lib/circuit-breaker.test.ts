import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createCircuitBreaker } from '../../../src/lib/circuit-breaker.js';

describe('createCircuitBreaker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('stays closed below the failure threshold', () => {
    const breaker = createCircuitBreaker({ threshold: 3, cooldownMs: 1000 });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });

  it('opens once the threshold is reached', () => {
    const breaker = createCircuitBreaker({ threshold: 3, cooldownMs: 1000 });
    for (let i = 0; i < 3; i++) breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it('closes again after the cooldown elapses', () => {
    const breaker = createCircuitBreaker({ threshold: 2, cooldownMs: 1000 });
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);

    vi.advanceTimersByTime(1001);
    expect(breaker.isOpen()).toBe(false);
  });

  it('a success resets the failure count', () => {
    const breaker = createCircuitBreaker({ threshold: 2, cooldownMs: 1000 });
    breaker.recordFailure();
    breaker.recordSuccess();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(false);
  });

  it('reopens if the probe after cooldown fails again', () => {
    const breaker = createCircuitBreaker({ threshold: 2, cooldownMs: 1000 });
    breaker.recordFailure();
    breaker.recordFailure();
    vi.advanceTimersByTime(1001);

    // After a cooldown the counter restarts, so it takes `threshold` failures to reopen.
    breaker.recordFailure();
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
  });

  it('reset() closes the breaker immediately', () => {
    const breaker = createCircuitBreaker({ threshold: 1, cooldownMs: 10_000 });
    breaker.recordFailure();
    expect(breaker.isOpen()).toBe(true);
    breaker.reset();
    expect(breaker.isOpen()).toBe(false);
  });
});
