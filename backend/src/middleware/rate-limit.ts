import type { FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { clientIp } from '../lib/client-ip.js';

export async function setupRateLimit(app: FastifyInstance) {
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    // Per-route rateLimit configs inherit this key generator.
    keyGenerator: clientIp,
    errorResponseBuilder: () => ({
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
    }),
  });
}
