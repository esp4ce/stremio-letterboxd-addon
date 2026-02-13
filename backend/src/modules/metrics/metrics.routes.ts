import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getMetricsSummary } from '../../lib/metrics.js';

export async function metricsRoutes(app: FastifyInstance) {
  app.get(
    '/metrics',
    async (
      request: FastifyRequest<{
        Querystring: { days?: string };
      }>
    ) => {
      const days = request.query.days ? parseInt(request.query.days, 10) : 30;
      const clampedDays = Math.min(Math.max(days, 1), 365);
      return getMetricsSummary(clampedDays);
    }
  );
}
