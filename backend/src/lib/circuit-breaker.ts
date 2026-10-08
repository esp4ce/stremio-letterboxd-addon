export interface CircuitBreakerOptions {
  /** Consecutive failures that open the circuit. */
  threshold: number;
  /** How long the circuit stays open before the next attempt is allowed through. */
  cooldownMs: number;
}

export interface CircuitBreaker {
  /** True while calls should be skipped. */
  isOpen(): boolean;
  recordSuccess(): void;
  /** Returns true when this failure is the one that opened the circuit. */
  recordFailure(): boolean;
  reset(): void;
}

/**
 * Minimal in-memory circuit breaker for an upstream endpoint that is known to fail as a
 * whole rather than per item. Skipping it costs one lost shortcut; calling it when it is
 * down costs a request from the shared upstream budget, which is the scarcer resource.
 */
export function createCircuitBreaker({ threshold, cooldownMs }: CircuitBreakerOptions): CircuitBreaker {
  let failures = 0;
  let openUntil = 0;

  return {
    isOpen() {
      return Date.now() < openUntil;
    },
    recordSuccess() {
      failures = 0;
      openUntil = 0;
    },
    recordFailure() {
      failures++;
      if (failures < threshold) return false;
      failures = 0;
      openUntil = Date.now() + cooldownMs;
      return true;
    },
    reset() {
      failures = 0;
      openUntil = 0;
    },
  };
}
