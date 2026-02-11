import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyUserToken, type UserTokenPayload } from '../lib/jwt.js';

declare module 'fastify' {
  interface FastifyRequest {
    userPayload?: UserTokenPayload;
  }
}

export async function authMiddleware(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const authHeader = request.headers.authorization;

  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);
  const payload = await verifyUserToken(token);

  if (!payload) {
    return reply.status(401).send({ error: 'Invalid or expired token' });
  }

  request.userPayload = payload;
}
