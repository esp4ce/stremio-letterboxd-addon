import { describe, it, expect } from 'vitest';
import {
  cacheKeyWatchlist,
  cacheKeyDiary,
  cacheKeyFriends,
  cacheKeyLiked,
  cacheKeyList,
  cacheKeyPopular,
  cacheKeyTop250,
  cacheKeyPublicWatchlist,
  cacheKeyReco,
  filterSuffix,
} from '../../../../src/modules/stremio/catalog/catalog-cache-keys.js';

describe('catalog-cache-keys', () => {
  describe('filterSuffix', () => {
    it('returns empty string when no genre or decade', () => {
      expect(filterSuffix()).toBe('');
    });

    it('includes genre codes', () => {
      expect(filterSuffix(['7I', '2b'])).toBe(':g:7I,2b');
    });

    it('includes decade', () => {
      expect(filterSuffix(undefined, 1990)).toBe(':d:1990');
    });

    it('includes both genre and decade', () => {
      expect(filterSuffix(['7I'], 2000)).toBe(':g:7I:d:2000');
    });
  });

  describe('deterministic cache keys', () => {
    it('produces same key for same watchlist params', () => {
      const a = cacheKeyWatchlist('u1', true, 'DateLatestFirst');
      const b = cacheKeyWatchlist('u1', true, 'DateLatestFirst');

      expect(a).toBe(b);
    });

    it('produces same key for same diary params', () => {
      const a = cacheKeyDiary('u1', false);
      const b = cacheKeyDiary('u1', false);

      expect(a).toBe(b);
    });
  });

  describe('user isolation', () => {
    it('different users produce different watchlist keys', () => {
      const a = cacheKeyWatchlist('user-a', true);
      const b = cacheKeyWatchlist('user-b', true);

      expect(a).not.toBe(b);
    });

    it('different users produce different friends keys', () => {
      const a = cacheKeyFriends('user-a', true);
      const b = cacheKeyFriends('user-b', true);

      expect(a).not.toBe(b);
    });

    it('different users produce different diary keys', () => {
      const a = cacheKeyDiary('user-a', true);
      const b = cacheKeyDiary('user-b', true);

      expect(a).not.toBe(b);
    });
  });

  describe('parameter differentiation', () => {
    it('different showRatings yields different keys', () => {
      const a = cacheKeyPopular(true);
      const b = cacheKeyPopular(false);

      expect(a).not.toBe(b);
    });

    it('different sort yields different keys', () => {
      const a = cacheKeyTop250(true, 'FilmName');
      const b = cacheKeyTop250(true, 'FilmPopularity');

      expect(a).not.toBe(b);
    });

    it('different genre yields different keys', () => {
      const a = cacheKeyWatchlist('u1', true, undefined, ['7I']);
      const b = cacheKeyWatchlist('u1', true, undefined, ['2b']);

      expect(a).not.toBe(b);
    });

    it('different decade yields different keys', () => {
      const a = cacheKeyLiked('u1', true, undefined, undefined, 1990);
      const b = cacheKeyLiked('u1', true, undefined, undefined, 2000);

      expect(a).not.toBe(b);
    });

    it('different list IDs yield different keys', () => {
      const a = cacheKeyList('u1', 'listA', true);
      const b = cacheKeyList('u1', 'listB', true);

      expect(a).not.toBe(b);
    });
  });

  describe('public cache keys', () => {
    it('public watchlist includes memberId', () => {
      const key = cacheKeyPublicWatchlist('member-1', true);

      expect(key).toContain('member-1');
    });

    it('recommendation key includes userId', () => {
      const key = cacheKeyReco('user-1', 'FilmName');

      expect(key).toContain('user-1');
      expect(key).toContain('FilmName');
    });
  });

  describe('default sort value', () => {
    it('uses "default" when sort is undefined', () => {
      const key = cacheKeyDiary('u1', true);

      expect(key).toContain('default');
    });

    it('popular defaults to FilmPopularityThisWeek', () => {
      const key = cacheKeyPopular(true);

      expect(key).toContain('FilmPopularityThisWeek');
    });
  });
});
