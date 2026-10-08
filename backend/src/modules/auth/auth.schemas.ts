import { z } from 'zod';
import { isValidTimeZone } from '../native-sync/job-rules.js';

export const loginBodySchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
  totp: z.string().optional(),
  rememberMe: z.boolean().optional().default(true),
});

export type LoginBody = z.infer<typeof loginBodySchema>;

export const userPreferencesSchema = z.object({
  catalogs: z.object({
    watchlist: z.boolean(),
    diary: z.boolean(),
    friends: z.boolean(),
    popular: z.boolean().default(false),
    top250: z.boolean().default(true),
    likedFilms: z.boolean().default(false),
    recommended: z.boolean().default(true),
  }),
  ownLists: z.array(z.string()),
  externalLists: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      owner: z.string(),
      filmCount: z.number(),
    })
  ),
  externalWatchlists: z.array(
    z.object({
      username: z.string(),
      displayName: z.string(),
    })
  ).optional(),
  contributors: z.array(
    z.object({
      t: z.enum(['d', 'a', 's']),
      id: z.string(),
      name: z.string(),
    })
  ).optional(),
  showActions: z.boolean().default(true),
  showRatings: z.boolean().default(true),
  showReviews: z.boolean().optional(),
  hideUnreleased: z.boolean().optional(),
  hideNoHomeRelease: z.boolean().optional(),
  search: z.boolean().optional(),
  catalogNames: z.record(z.string(), z.string()).optional(),
  catalogOrder: z.array(z.string()).optional(),
  sortVariants: z.record(z.string(), z.array(z.string())).optional(),
  nativeSync: z.boolean().optional(),
  timezone: z.string().max(64).refine(isValidTimeZone).optional().catch(undefined),
});

// The session token travels in an httpOnly cookie, never in the response body.
export const loginResponseSchema = z.object({
  manifestUrl: z.string(),
  user: z.object({
    id: z.string(),
    username: z.string(),
    displayName: z.string().nullable(),
  }),
  lists: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      filmCount: z.number(),
      description: z.string().optional(),
    })
  ),
  preferences: userPreferencesSchema.nullable(),
});

export type LoginResponse = z.infer<typeof loginResponseSchema>;

export const preferencesBodySchema = z.object({
  preferences: userPreferencesSchema,
});

export type PreferencesBody = z.infer<typeof preferencesBodySchema>;
