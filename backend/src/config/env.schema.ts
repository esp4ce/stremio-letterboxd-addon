import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  PUBLIC_URL: z.string().url().default('http://localhost:3001'),

  ENABLE_HTTPS: z
    .string()
    .transform((val) => val === 'true')
    .default(false),
  HTTPS_CERT_PATH: z.string().default('./certs/localhost-cert.pem'),
  HTTPS_KEY_PATH: z.string().default('./certs/localhost-key.pem'),

  CATALOG_CLIENT_ID: z.string().min(1),
  CATALOG_CLIENT_SECRET: z.string().min(1),
  CATALOG_USER_AGENT: z.string().default('StremioAddon/1.0.0'),

  ENCRYPTION_KEY: z
    .string()
    .length(64, 'ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
    .regex(/^[0-9a-fA-F]+$/, 'ENCRYPTION_KEY must be hexadecimal'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL: z.string().default('7d'),
  ENTITLED_SESSION_TTL: z.string().default('365d'),
  DASHBOARD_PASSWORD: z.string().min(8, 'DASHBOARD_PASSWORD must be at least 8 characters'),
  // Optional: see isPolarConfigured in config/index.ts.
  POLAR_ACCESS_TOKEN: z.string().min(1).optional(),
  POLAR_PRODUCT_ID_YEARLY: z.string().min(1).optional(),
  POLAR_PRODUCT_ID_MONTHLY: z.string().min(1).optional(),
  // Both set = Founder seats are on sale (see isFounderConfigured). Never unset the benefit id
  // once seats are sold: it is what grants existing Founders their access.
  POLAR_PRODUCT_ID_FOUNDER: z.string().min(1).optional(),
  POLAR_FOUNDER_BENEFIT_ID: z.string().min(1).optional(),
  POLAR_SERVER: z.enum(['production', 'sandbox']).default('production'),
  FRONTEND_URL: z.string().url().default('https://stremboxd.com'),

  DATABASE_PATH: z.string().default('./data/stremio-letterboxd.db'),

  // Scheduled SQLite snapshots. Remote upload is a no-op unless the S3 vars are set.
  BACKUP_ENABLED: z
    .string()
    .transform((val) => val !== 'false')
    .default(true),
  BACKUP_INTERVAL_HOURS: z.coerce.number().positive().default(24),
  BACKUP_INITIAL_DELAY_MINUTES: z.coerce.number().min(0).default(10),
  BACKUP_KEEP: z.coerce.number().int().min(1).default(3),
  BACKUP_DIR: z.string().min(1).optional(),
  BACKUP_S3_ENDPOINT: z.string().optional(),
  BACKUP_S3_BUCKET: z.string().optional(),
  BACKUP_S3_REGION: z.string().default('auto'),
  BACKUP_S3_ACCESS_KEY_ID: z.string().optional(),
  BACKUP_S3_SECRET_ACCESS_KEY: z.string().optional(),
  BACKUP_S3_PREFIX: z.string().default('stremboxd/'),

  CACHE_MAX_SIZE: z.coerce.number().default(1000),
  CACHE_FILM_TTL: z.coerce.number().default(3600),
  CACHE_WATCHLIST_TTL: z.coerce.number().default(300),

  TMDB_API_KEY: z.string().min(1).optional(),

  POSTHOG_API_KEY: z.string().min(1).optional(),
  POSTHOG_HOST: z.string().url().default('https://us.i.posthog.com'),

  CORS_ORIGIN: z
    .string()
    .default('http://localhost:3000')
    .refine(
      (val) => !val.split(',').map((o) => o.trim()).includes('*'),
      'CORS_ORIGIN must not contain "*" — list explicit origins separated by commas',
    )
    .refine(
      (val) => val.split(',').every((o) => /^https?:\/\/[^\s,]+$/.test(o.trim())),
      'CORS_ORIGIN entries must be valid http(s) URLs',
    ),
  LOG_LEVEL: z
    .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
    .default('info'),
});

export type Env = z.infer<typeof envSchema>;
