import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { findUserById, getUserPreferences } from '../../db/repositories/user.repository.js';
import { enqueueJob } from '../../db/repositories/native-sync-job.repository.js';
import { createChildLogger } from '../../lib/logger.js';
import { parseLibraryExtra, parsePlayerExtra } from './event-parser.js';
import { draftFromLibraryEvent, draftFromPlayerEvent, type JobDraft } from './job-rules.js';

const logger = createChildLogger('native-sync-routes');

const IMDB_ID = /^tt\d{1,10}$/;
const OK = { success: true } as const;
const RATE_LIMIT = { rateLimit: { max: 120, timeWindow: '1 minute' } };

type EventRequest = FastifyRequest<{ Params: { userId: string; type: string; id: string; extra: string } }>;

function draftFor(resource: 'player' | 'library', extra: string, now: Date, timezone?: string): JobDraft | null {
  if (resource === 'player') {
    const event = parsePlayerExtra(extra);
    return event ? draftFromPlayerEvent(event, now, timezone) : null;
  }
  const event = parseLibraryExtra(extra);
  return event ? draftFromLibraryEvent(event, now, timezone) : null;
}

function handler(resource: 'player' | 'library') {
  return async (request: EventRequest, reply: FastifyReply) => {
    reply.header('Access-Control-Allow-Origin', '*');
    const { userId, type, id, extra } = request.params;

    try {
      if (type !== 'movie' || !IMDB_ID.test(id)) return OK;

      const user = findUserById(userId);
      if (!user?.encrypted_refresh_token) return OK;

      const preferences = getUserPreferences(user);
      if (preferences?.nativeSync !== true) return OK;

      const draft = draftFor(resource, extra, new Date(), preferences.timezone);
      if (draft && enqueueJob({ userId, imdbId: id, ...draft })) {
        logger.info({ userId, kind: draft.kind }, 'Native sync job queued');
      }
    } catch (err) {
      // Stremio ignores the response: never let an event turn into an error page.
      logger.warn({ userId, reason: err instanceof Error ? err.name : 'unknown' }, 'Native sync event dropped');
    }
    return OK;
  };
}

export async function nativeSyncRoutes(app: FastifyInstance): Promise<void> {
  app.get('/stremio/:userId/player/:type/:id/:extra.json', { config: RATE_LIMIT }, handler('player'));
  app.get('/stremio/:userId/library/:type/:id/:extra.json', { config: RATE_LIMIT }, handler('library'));
}
