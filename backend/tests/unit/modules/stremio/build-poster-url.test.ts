import { describe, it, expect } from 'vitest';
import { buildPosterUrl } from '../../../../src/modules/stremio/catalog.service.js';

const POSTER = 'https://a.ltrbxd.com/resized/film-poster-300.jpg';

describe('buildPosterUrl', () => {
  it('carries the friend name in the by parameter', () => {
    const url = new URL(buildPosterUrl(POSTER, 4.2, 'Joel Haver')!);
    expect(url.pathname).toBe('/poster');
    expect(url.searchParams.get('by')).toBe('Joel Haver');
    expect(url.searchParams.get('rating')).toBe('4.2');
  });

  it('builds a poster URL without a rating when a friend is given', () => {
    const url = new URL(buildPosterUrl(POSTER, undefined, 'Joel')!);
    expect(url.pathname).toBe('/poster');
    expect(url.searchParams.get('by')).toBe('Joel');
    expect(url.searchParams.has('rating')).toBe(false);
  });

  it('is unchanged without a friend (legacy behaviour)', () => {
    expect(buildPosterUrl(POSTER, undefined)).toBe(POSTER);
    expect(new URL(buildPosterUrl(POSTER, 3.5)!).searchParams.has('by')).toBe(false);
  });
});
