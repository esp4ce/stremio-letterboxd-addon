import { describe, it, expect } from 'vitest';
import { loginBodySchema, userPreferencesSchema } from '../../../../src/modules/auth/auth.schemas.js';

describe('auth schemas (Zod)', () => {
  describe('loginBodySchema', () => {
    it('accepts valid username and password', () => {
      const result = loginBodySchema.safeParse({
        username: 'testuser',
        password: 'secret123',
      });
      expect(result.success).toBe(true);
    });

    it('accepts login with optional totp', () => {
      const result = loginBodySchema.safeParse({
        username: 'testuser',
        password: 'secret123',
        totp: '123456',
      });
      expect(result.success).toBe(true);
    });

    it('rejects empty username', () => {
      const result = loginBodySchema.safeParse({
        username: '',
        password: 'secret',
      });
      expect(result.success).toBe(false);
    });

    it('rejects empty password', () => {
      const result = loginBodySchema.safeParse({
        username: 'user',
        password: '',
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing fields', () => {
      expect(loginBodySchema.safeParse({}).success).toBe(false);
      expect(loginBodySchema.safeParse({ username: 'a' }).success).toBe(false);
    });
  });

  describe('userPreferencesSchema', () => {
    const validPrefs = {
      catalogs: {
        watchlist: true,
        diary: true,
        friends: false,
        popular: true,
        top250: true,
        likedFilms: false,
        recommended: true,
      },
      ownLists: ['list1'],
      externalLists: [],
    };

    it('accepts valid preferences', () => {
      const result = userPreferencesSchema.safeParse(validPrefs);
      expect(result.success).toBe(true);
    });

    it('applies defaults for optional boolean fields', () => {
      const result = userPreferencesSchema.parse(validPrefs);
      expect(result.showActions).toBe(true);
      expect(result.showRatings).toBe(true);
    });

    it('accepts preferences with all optional fields', () => {
      const full = {
        ...validPrefs,
        externalWatchlists: [{ username: 'alice', displayName: 'Alice' }],
        contributors: [{ t: 'd' as const, id: 'xyz', name: 'Director X' }],
        showActions: false,
        showRatings: false,
        showReviews: true,
        hideUnreleased: true,
        catalogNames: { 'letterboxd-popular': 'My Pop' },
        catalogOrder: ['letterboxd-top250'],
        sortVariants: { 'letterboxd-popular': ['shuffle'] },
      };
      const result = userPreferencesSchema.safeParse(full);
      expect(result.success).toBe(true);
    });

    it('rejects invalid catalogs object', () => {
      const result = userPreferencesSchema.safeParse({
        ...validPrefs,
        catalogs: { watchlist: 'yes' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects invalid contributor type', () => {
      const result = userPreferencesSchema.safeParse({
        ...validPrefs,
        contributors: [{ t: 'x', id: '1', name: 'Bad' }],
      });
      expect(result.success).toBe(false);
    });
  });
});
