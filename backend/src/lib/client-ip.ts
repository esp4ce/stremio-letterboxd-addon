import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

/**
 * Behind the Railway edge, request.ip is the proxy's address. The edge documents
 * only X-Real-IP (the client's remote IP); X-Forwarded-For is deliberately not
 * trusted. Anything that is not a single valid IP falls back to request.ip.
 */
export function clientIp(request: FastifyRequest): string {
  const header = request.headers['x-real-ip'];
  if (typeof header === 'string') {
    const candidate = header.trim();
    if (candidate !== '' && isIP(candidate) !== 0) return candidate;
  }
  return request.ip;
}
