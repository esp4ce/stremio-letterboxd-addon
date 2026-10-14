import { envSchema, type Env } from './env.schema.js';

function loadConfig(): Env {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment variables:');
    for (const issue of result.error.issues) {
      console.error(`  - ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}

export const config = loadConfig();

export const catalogConfig = {
  clientId: config.CATALOG_CLIENT_ID,
  clientSecret: config.CATALOG_CLIENT_SECRET,
  userAgent: config.CATALOG_USER_AGENT,
} as const;

export const jwtConfig = {
  secret: config.JWT_SECRET,
  ttl: config.JWT_TTL,
  entitledTtl: config.ENTITLED_SESSION_TTL,
} as const;

export const polarConfig = {
  accessToken: config.POLAR_ACCESS_TOKEN,
  productIdYearly: config.POLAR_PRODUCT_ID_YEARLY,
  productIdMonthly: config.POLAR_PRODUCT_ID_MONTHLY,
  productIdFounder: config.POLAR_PRODUCT_ID_FOUNDER,
  founderBenefitId: config.POLAR_FOUNDER_BENEFIT_ID,
  server: config.POLAR_SERVER,
  frontendUrl: config.FRONTEND_URL,
} as const;

/** Optional integration: unset means billing routes return 503 and entitlement resolves to false. */
export const isPolarConfigured =
  Boolean(config.POLAR_ACCESS_TOKEN) &&
  Boolean(config.POLAR_PRODUCT_ID_YEARLY) &&
  Boolean(config.POLAR_PRODUCT_ID_MONTHLY);

/** The Founder offer is shown and sold only when both ids are set — that pair is its on/off switch. */
export const isFounderConfigured =
  isPolarConfigured && Boolean(config.POLAR_PRODUCT_ID_FOUNDER) && Boolean(config.POLAR_FOUNDER_BENEFIT_ID);

export interface ResolvedPolarConfig {
  accessToken: string;
  productIdYearly: string;
  productIdMonthly: string;
  productIdFounder?: string;
  founderBenefitId?: string;
  server: 'production' | 'sandbox';
  frontendUrl: string;
}

/** Throws if Polar isn't configured — callers must check `isPolarConfigured` first. */
export function requirePolarConfig(): ResolvedPolarConfig {
  if (!isPolarConfigured) {
    throw new Error('Billing is not configured');
  }
  return polarConfig as ResolvedPolarConfig;
}

export const corsOrigins = config.CORS_ORIGIN.split(',').map((o) => o.trim());

export const cacheConfig = {
  maxSize: config.CACHE_MAX_SIZE,
  filmTtl: config.CACHE_FILM_TTL * 1000,
  watchlistTtl: config.CACHE_WATCHLIST_TTL * 1000,
} as const;

export const tmdbConfig = {
  apiKey: config.TMDB_API_KEY,
} as const;

export const serverConfig = {
  publicUrl: config.PUBLIC_URL,
} as const;
