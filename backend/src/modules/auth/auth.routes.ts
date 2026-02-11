import type { FastifyInstance, FastifyRequest } from 'fastify';
import { loginBodySchema, preferencesBodySchema } from './auth.schemas.js';
import { loginUser, AuthenticationError } from './auth.service.js';
import { verifyUserToken } from '../../lib/jwt.js';
import {
  findUserById,
  updateUserPreferences,
} from '../../db/repositories/user.repository.js';
import { loginRateLimit } from '../../middleware/rate-limit.js';
import { trackEvent } from '../../lib/metrics.js';

export async function authRoutes(app: FastifyInstance) {
  app.post(
    '/auth/login',
    {
      config: { rateLimit: loginRateLimit },
      schema: {
        body: {
          type: 'object',
          properties: {
            username: { type: 'string' },
            password: { type: 'string' },
          },
          required: ['username', 'password'],
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { username: string; password: string };
      }>,
      reply
    ) => {
      const body = loginBodySchema.safeParse(request.body);

      if (!body.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: body.error.issues,
        });
      }

      try {
        const result = await loginUser(body.data.username, body.data.password);
        trackEvent('login', result.user?.id);
        return result;
      } catch (error) {
        if (error instanceof AuthenticationError) {
          const statusCode =
            error.code === 'INVALID_CREDENTIALS' ? 401 : 503;
          return reply.status(statusCode).send({
            error: error.message,
            code: error.code,
          });
        }
        throw error;
      }
    }
  );

  app.post(
    '/auth/preferences',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            userToken: { type: 'string' },
            preferences: { type: 'object' },
          },
          required: ['userToken', 'preferences'],
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { userToken: string; preferences: unknown };
      }>,
      reply
    ) => {
      const parsed = preferencesBodySchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          details: parsed.error.issues,
        });
      }

      const payload = await verifyUserToken(parsed.data.userToken);
      if (!payload) {
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }

      const user = findUserById(payload.sub);
      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      updateUserPreferences(user.id, parsed.data.preferences);

      return { success: true };
    }
  );
}
