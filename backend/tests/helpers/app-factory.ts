import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app.js';
import { initDb, closeDb } from '../../src/db/index.js';

/**
 * Creates an isolated Fastify instance with in-memory SQLite.
 * Call `cleanup()` in afterAll to close app + DB.
 */
export async function buildTestApp(): Promise<{ app: FastifyInstance; cleanup: () => Promise<void> }> {
  initDb();
  const app = await buildApp();
  await app.ready();

  return {
    app,
    cleanup: async () => {
      await app.close();
      closeDb();
    },
  };
}
