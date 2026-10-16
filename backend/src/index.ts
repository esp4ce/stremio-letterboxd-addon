import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { configure } from '@esp4ce/letterboxd-client';
import { buildApp } from './app.js';
import { initDb, closeDb, getDb } from './db/index.js';
import { backupOptionsFromEnv, startBackupScheduler } from './lib/backup.js';
import { startNativeSyncWorker } from './modules/native-sync/native-sync.worker.js';
import { config, catalogConfig } from './config/index.js';
import { logger, createChildLogger } from './lib/logger.js';
import { purgeOldEventsInBatches } from './lib/metrics.js';
import { shutdownPosthog } from './lib/posthog.js';

const EVENT_PURGE_EVERY_MS = 6 * 60 * 60 * 1000;

async function main() {
  logger.info('Starting Stremio Addon Backend...');

  try {
    initDb();
  } catch (error) {
    logger.fatal(
      { err: error instanceof Error ? { message: error.message, stack: error.stack } : error },
      'Database initialization failed — refusing to start on an outdated schema.'
    );
    process.exit(1);
  }

  configure({
    clientId: catalogConfig.clientId,
    clientSecret: catalogConfig.clientSecret,
    userAgent: catalogConfig.userAgent,
    logger: createChildLogger('catalog-client'),
  });

  let app;

  if (config.ENABLE_HTTPS) {
    try {
      const httpsOptions = {
        key: readFileSync(config.HTTPS_KEY_PATH),
        cert: readFileSync(config.HTTPS_CERT_PATH),
      };
      app = await buildApp(httpsOptions);
      logger.info('HTTPS enabled with certificates');
    } catch (error) {
      logger.fatal(
        { err: error instanceof Error ? { message: error.message, stack: error.stack } : error },
        'Failed to load SSL certificates. Run "cd certs && generate.bat" to generate them.'
      );
      process.exit(1);
    }
  } else {
    app = await buildApp();
    logger.info('HTTP mode (no HTTPS)');
  }

  const stopBackups = startBackupScheduler(getDb, backupOptionsFromEnv(config));
  const stopNativeSync = startNativeSyncWorker();

  const runEventPurge = () => {
    purgeOldEventsInBatches()
      .then((deletedCount) => {
        if (deletedCount > 0) logger.info({ deletedCount }, 'Cleaned up old events');
      })
      .catch((err: unknown) => logger.warn({ err }, 'Event purge failed'));
  };
  const eventPurgeTimer = setInterval(runEventPurge, EVENT_PURGE_EVERY_MS);
  eventPurgeTimer.unref();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received shutdown signal');
    clearInterval(eventPurgeTimer);
    stopBackups();
    const nativeSyncStopped = stopNativeSync();
    await app.close();
    await nativeSyncStopped;
    await shutdownPosthog();
    closeDb();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    logger.info(
      { port: config.PORT, url: config.PUBLIC_URL, https: config.ENABLE_HTTPS },
      'Server started'
    );
    runEventPurge();
  } catch (error) {
    logger.fatal({ error }, 'Failed to start server');
    process.exit(1);
  }
}

main();
