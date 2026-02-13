import { z } from 'zod';

export const resolveFilmQuerySchema = z.object({
  title: z.string().optional(),
  year: z.coerce.number().optional(),
  imdbId: z.string().optional(),
  tmdbId: z.string().optional(),
});

export type ResolveFilmQuery = z.infer<typeof resolveFilmQuerySchema>;

export const filmRatingQuerySchema = z.object({
  filmId: z.string().min(1),
});

export type FilmRatingQuery = z.infer<typeof filmRatingQuerySchema>;

export const filmResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  releaseYear: z.number().optional(),
  poster: z
    .object({
      sizes: z.array(
        z.object({
          width: z.number(),
          height: z.number(),
          url: z.string(),
        })
      ),
    })
    .optional(),
  imdbId: z.string().optional(),
  tmdbId: z.string().optional(),
});

export const filmRatingResponseSchema = z.object({
  filmId: z.string(),
  userRating: z.number().nullable(),
  watched: z.boolean(),
  liked: z.boolean(),
  inWatchlist: z.boolean(),
  communityRating: z.number().nullable(),
  communityRatings: z.number(),
});
