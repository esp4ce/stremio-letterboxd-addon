import type { FastifyInstance } from 'fastify';
import { isPolarConfigured } from '../../config/index.js';
import { sessionMiddleware } from '../../middleware/auth.middleware.js';
import { createChildLogger } from '../../lib/logger.js';
import { z } from 'zod';
import { startCheckout, getPortalUrl, getOffer, FounderUnavailableError } from './billing.service.js';

const logger = createChildLogger('billing-routes');

// Not strict: unknown keys (e.g. a client-sent userId) are ignored, never trusted.
const checkoutBodySchema = z.object({ offer: z.enum(['supporter', 'founder']).optional() }).nullish();

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

      const parsed = checkoutBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid offer' });
      }
      const offer = parsed.data?.offer ?? 'supporter';

      // The Polar customer is always the session user, never a body field.
      try {
        const url = await startCheckout(request.sessionUser!, offer);
        return { url };
      } catch (err) {
        if (err instanceof FounderUnavailableError) {
          return err.reason === 'sold_out'
            ? reply.status(410).send({ error: 'Founder seats are gone' })
            : reply.status(404).send({ error: 'No Founder offer' });
        }
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
