import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { createChildLogger } from '../lib/logger.js';
import { sanitizeUrlForLog } from '../lib/log-sanitize.js';
import { sendHtml, buildErrorPage } from '../modules/stremio/action/action-html.js';

const logger = createChildLogger('error-handler');

// /action/* links are opened directly in a device browser (from a Stremio
// stream's externalUrl), never fetched by app code — a bare JSON error body
// renders as an unstyled white page there. Every other route is consumed by
// Stremio/clients expecting JSON, so only this prefix gets the HTML page.
function isActionRoute(url: string): boolean {
  return url.startsWith('/action/');
}

export function errorHandler(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  logger.error(
    {
      err: error,
      url: sanitizeUrlForLog(request.url),
      method: request.method,
    },
    'Request error'
  );

  const actionRoute = isActionRoute(request.url);

  if (error.validation) {
    if (actionRoute) {
      return sendHtml(reply, buildErrorPage('Invalid link', 'This link is malformed. Please try again from Stremio.'), 400);
    }
    return reply.status(400).send({
      error: 'Validation error',
      details: error.validation,
    });
  }

  if (error.code === 'RATE_LIMIT_EXCEEDED' || error.statusCode === 429) {
    if (actionRoute) {
      return sendHtml(reply, buildErrorPage('Too many requests', 'Please wait a moment and try again.'), 429);
    }
    return reply.status(429).send({
      error: 'Please wait before trying again.',
      code: 'RATE_LIMIT_EXCEEDED',
    });
  }

  if (error.statusCode) {
    if (actionRoute) {
      return sendHtml(reply, buildErrorPage('Error', error.message), error.statusCode);
    }
    return reply.status(error.statusCode).send({
      error: error.message,
    });
  }

  if (actionRoute) {
    return sendHtml(reply, buildErrorPage('Internal server error'), 500);
  }
  return reply.status(500).send({
    error: 'Internal server error',
  });
}
