import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { createChildLogger } from '../lib/logger.js';

const logger = createChildLogger('error-handler');

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  logger.error(
    {
      err: error,
      url: request.url,
      method: request.method,
    },
    'Request error'
  );

  if (error.validation) {
    return reply.status(400).send({
      error: 'Validation error',
      details: error.validation,
    });
  }

  if (error.code === 'RATE_LIMIT_EXCEEDED' || error.statusCode === 429) {
    return reply.status(429).send({
      error: 'Please wait before trying again.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  }

  if (error.statusCode) {
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }

  return reply.status(500).send({
    error: 'Internal server error',
  });
}
