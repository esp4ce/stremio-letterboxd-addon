import Fastify from 'fastify';
import type { ServerOptions } from 'node:https';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import compress from '@fastify/compress';
import sharp from 'sharp';
import { config, corsOrigins } from './config/index.js';
import { logger } from './lib/logger.js';
import { sanitizeUrlForLog } from './lib/log-sanitize.js';
import { errorHandler } from './middleware/error-handler.js';
import { setupRateLimit } from './middleware/rate-limit.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { letterboxdRoutes } from './modules/letterboxd/letterboxd.routes.js';
import { stremioRoutes } from './modules/stremio/stremio.routes.js';
import { dashboardRoutes } from './modules/dashboard/dashboard.routes.js';
import { billingRoutes } from './modules/billing/billing.routes.js';
import { generateBaseManifest } from './modules/stremio/stremio.service.js';
import { startMemoryGuard } from './lib/memory-guard.js';

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="#0a0a0a"/>
  <circle cx="8" cy="16" r="3" fill="#ffffff"/>
  <circle cx="16" cy="16" r="3" fill="#e4e4e7"/>
  <circle cx="24" cy="16" r="3" fill="#a1a1aa"/>
</svg>`;

// Pre-convert SVG to raster formats once at startup for TV/Android client compatibility
let logoPngBuffer: Buffer | null = null;
let backgroundJpgBuffer: Buffer | null = null;

async function getLogoPng(): Promise<Buffer> {
  if (!logoPngBuffer) {
    logoPngBuffer = await sharp(Buffer.from(LOGO_SVG)).resize(256, 256).png().toBuffer();
  }
  return logoPngBuffer;
}

async function getBackgroundJpg(): Promise<Buffer> {
  if (!backgroundJpgBuffer) {
    const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 562">
  <rect width="1000" height="562" fill="#0a0a0a"/>
  <circle cx="350" cy="281" r="80" fill="#ffffff" opacity="0.12"/>
  <circle cx="500" cy="281" r="80" fill="#e4e4e7" opacity="0.12"/>
  <circle cx="650" cy="281" r="80" fill="#a1a1aa" opacity="0.12"/>
</svg>`;
    backgroundJpgBuffer = await sharp(Buffer.from(bgSvg)).resize(1000, 562).jpeg({ quality: 85 }).toBuffer();
  }
  return backgroundJpgBuffer;
}

export async function buildApp(httpsOptions?: ServerOptions) {
  const app = Fastify({
    logger: false,
    routerOptions: { maxParamLength: 10000 },
    ...(httpsOptions && { https: httpsOptions }),
  });

  await app.register(cors, {
    origin: corsOrigins,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    // Required for the session cookie to travel from the frontend origin.
    // Safe only because CORS_ORIGIN is an explicit allowlist (no wildcard).
    credentials: true,
  });
  logger.info({ origins: corsOrigins }, 'CORS configured');

  // Browsers treat http:// and https:// as different sites, so a SameSite=Lax
  // session cookie is dropped when the frontend and the API disagree on scheme.
  const apiScheme = new URL(config.PUBLIC_URL).protocol;
  if (!corsOrigins.some((origin) => new URL(origin).protocol === apiScheme)) {
    logger.warn(
      { publicUrl: config.PUBLIC_URL, origins: corsOrigins },
      'No allowed origin shares the API scheme — the session cookie will be rejected by browsers',
    );
  }

  await app.register(cookie);

  await app.register(compress, { encodings: ['gzip'] });

  // Accept an empty JSON body (e.g. POST /billing/checkout sends none) instead
  // of Fastify's default 400 on empty application/json payloads.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
    if ((body as Buffer).length === 0) {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse((body as Buffer).toString('utf8')));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await setupRateLimit(app as any);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.setErrorHandler(errorHandler as any);

  app.get('/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }));

  app.get('/logo.svg', async (_request, reply) => {
    return reply
      .header('Content-Type', 'image/svg+xml')
      .header('Cache-Control', 'public, max-age=86400')
      .send(LOGO_SVG);
  });

  app.get('/logo.png', async (_request, reply) => {
    const buf = await getLogoPng();
    return reply
      .header('Content-Type', 'image/png')
      .header('Cache-Control', 'public, max-age=86400')
      .send(buf);
  });

  app.get('/background.jpg', async (_request, reply) => {
    const buf = await getBackgroundJpg();
    return reply
      .header('Content-Type', 'image/jpeg')
      .header('Cache-Control', 'public, max-age=86400')
      .send(buf);
  });

  app.get('/manifest.json', async (_request, reply) => {
    const manifest = generateBaseManifest();
    return reply
      .header('Content-Type', 'application/json')
      .header('Access-Control-Allow-Origin', '*')
      .header('Cache-Control', 'public, max-age=3600')
      .send(manifest);
  });

  // Stremio opens /configure when configurable: true in manifest
  // Redirect to the frontend configuration page
  app.get('/configure', async (_request, reply) => {
    return reply.redirect('https://stremboxd.com/configure');
  });

  await app.register(authRoutes);
  await app.register(letterboxdRoutes);
  await app.register(stremioRoutes);
  await app.register(dashboardRoutes);
  await app.register(billingRoutes);

  app.addHook('onRequest', async (request) => {
    logger.debug(
      {
        method: request.method,
        url: sanitizeUrlForLog(request.url),
      },
      'Incoming request'
    );

  });

  app.addHook('onResponse', async (request, reply) => {
    logger.info(
      {
        method: request.method,
        url: sanitizeUrlForLog(request.url),
        statusCode: reply.statusCode,
        responseTime: reply.elapsedTime,
      },
      'Request completed'
    );
  });

  startMemoryGuard();

  return app;
}
