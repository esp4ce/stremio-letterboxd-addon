import type { FastifyInstance } from 'fastify';
import { isPolarConfigured } from '../../config/index.js';
import { sessionMiddleware } from '../../middleware/auth.middleware.js';
import { createChildLogger } from '../../lib/logger.js';
import { startCheckout, getPortalUrl, getOffer } from './billing.service.js';

const logger = createChildLogger('billing-routes');

export async function billingRoutes(app: FastifyInstance) {
  // Public: what /pricing shows. Never fails — a Polar outage just hides the numbers.
  app.get(
    '/billing/offer',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (_request, reply) => {
      reply.header('Cache-Control', 'public, max-age=300');
      return getOffer();
    }
  );

  app.post(
    '/billing/checkout',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      preHandler: sessionMiddleware,
    },
    async (request, reply) => {
      if (!isPolarConfigured) {
        return reply.status(503).send({ error: 'Billing is not configured' });
      }

      // No body is read: the Polar customer is always the session user.
      try {
        const url = await startCheckout(request.sessionUser!);
        return { url };
      } catch (err) {
        logger.error({ userId: request.sessionUser!.id, reason: err instanceof Error ? err.message : 'unknown' }, 'Checkout creation failed');
        return reply.status(502).send({ error: 'Could not start checkout' });
      }
    }
  );

  app.get(
    '/billing/portal',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
      preHandler: sessionMiddleware,
    },
    async (request, reply) => {
      if (!isPolarConfigured) {
        return reply.status(503).send({ error: 'Billing is not configured' });
      }

      let portalUrl: string | null;
      try {
        portalUrl = await getPortalUrl(request.sessionUser!.id);
      } catch (err) {
        logger.error({ userId: request.sessionUser!.id, reason: err instanceof Error ? err.message : 'unknown' }, 'Portal session creation failed');
        return reply.status(502).send({ error: 'Could not open the subscription portal' });
      }

      if (!portalUrl) {
        return reply.status(404).send({ error: 'No subscription found' });
      }
      return reply.redirect(portalUrl, 302);
    }
  );
}
