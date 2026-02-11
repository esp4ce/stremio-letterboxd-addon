import type { FastifyInstance, FastifyRequest } from 'fastify';
import { resolveFilmQuerySchema, filmRatingQuerySchema } from './letterboxd.schemas.js';
import { resolveFilm, getFilmRating, parseLetterboxdListUrl, resolveExternalList } from './letterboxd.service.js';
import { verifyUserToken } from '../../lib/jwt.js';
import {
  findUserById,
  getDecryptedRefreshToken,
} from '../../db/repositories/user.repository.js';
import {
  createAuthenticatedClient,
  refreshAccessToken,
} from './letterboxd.client.js';
import { updateUser } from '../../db/repositories/user.repository.js';

async function getClientFromToken(userToken: string) {
  const payload = await verifyUserToken(userToken);
  if (!payload) {
    return null;
  }

  const user = findUserById(payload.sub);
  if (!user) {
    return null;
  }

  const refreshToken = getDecryptedRefreshToken(user);
  const tokens = await refreshAccessToken(refreshToken);

  updateUser(user.id, {
    refreshToken: tokens.refresh_token,
    tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
  });

  const client = createAuthenticatedClient(
    tokens.access_token,
    tokens.refresh_token,
    user.letterboxd_id,
    (newTokens) => {
      updateUser(user.id, {
        refreshToken: newTokens.refresh_token,
        tokenExpiresAt: new Date(Date.now() + newTokens.expires_in * 1000),
      });
    }
  );

  return { client, user, payload };
}

export async function letterboxdRoutes(app: FastifyInstance) {
  app.get(
    '/v1/resolve-film',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            title: { type: 'string' },
            year: { type: 'number' },
            imdbId: { type: 'string' },
            tmdbId: { type: 'string' },
          },
        },
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: {
          title?: string;
          year?: number;
          imdbId?: string;
          tmdbId?: string;
        };
        Headers: { authorization?: string };
      }>,
      reply
    ) => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Missing authorization header' });
      }

      const userToken = authHeader.slice(7);
      const result = await getClientFromToken(userToken);

      if (!result) {
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }

      const query = resolveFilmQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.issues });
      }

      if (!query.data.title && !query.data.imdbId && !query.data.tmdbId) {
        return reply
          .status(400)
          .send({ error: 'At least one of title, imdbId, or tmdbId is required' });
      }

      const film = await resolveFilm(result.client, query.data);

      if (!film) {
        return reply.status(404).send({ error: 'Film not found' });
      }

      return film;
    }
  );

  app.get(
    '/v1/film-rating',
    {
      schema: {
        querystring: {
          type: 'object',
          properties: {
            filmId: { type: 'string' },
          },
          required: ['filmId'],
        },
      },
    },
    async (
      request: FastifyRequest<{
        Querystring: { filmId: string };
        Headers: { authorization?: string };
      }>,
      reply
    ) => {
      const authHeader = request.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return reply.status(401).send({ error: 'Missing authorization header' });
      }

      const userToken = authHeader.slice(7);
      const result = await getClientFromToken(userToken);

      if (!result) {
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }

      const query = filmRatingQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({ error: query.error.issues });
      }

      const rating = await getFilmRating(
        result.client,
        query.data.filmId,
        result.user.letterboxd_id
      );

      return rating;
    }
  );

  app.post(
    '/letterboxd/resolve-list',
    {
      schema: {
        body: {
          type: 'object',
          properties: {
            userToken: { type: 'string' },
            url: { type: 'string' },
          },
          required: ['userToken', 'url'],
        },
      },
    },
    async (
      request: FastifyRequest<{
        Body: { userToken: string; url: string };
      }>,
      reply
    ) => {
      const { userToken, url } = request.body;

      const result = await getClientFromToken(userToken);
      if (!result) {
        return reply.status(401).send({ error: 'Invalid or expired token' });
      }

      const parsed = parseLetterboxdListUrl(url);
      if (!parsed) {
        return reply
          .status(400)
          .send({ error: 'Invalid Letterboxd list URL. Expected format: letterboxd.com/username/list/list-name/' });
      }

      try {
        const list = await resolveExternalList(
          result.client,
          parsed.username,
          parsed.slug
        );

        if (!list) {
          return reply.status(404).send({ error: 'List not found' });
        }

        return list;
      } catch (error) {
        return reply.status(500).send({ error: 'Failed to resolve list' });
      }
    }
  );
}
