import { describe, it, expect } from 'vitest';
import { encodeConfig, decodeConfig, type PublicConfig } from '../../../src/lib/config-encoding.js';

describe('config-encoding', () => {
  const minimalConfig: PublicConfig = {
    c: { popular: true, top250: false },
    l: [],
    r: false,
  };

  const fullConfig: PublicConfig = {
    u: 'testuser',
    c: { popular: true, top250: true, watchlist: true, likedFilms: true },
    l: ['abc123', 'def456'],
    f: [{ t: 'd', id: 'xyz' }],
    r: true,
    n: { 'letterboxd-popular': 'My Popular' },
    w: ['friend1'],
    o: ['letterboxd-top250', 'letterboxd-popular'],
    s: { 'letterboxd-popular': ['shuffle'] },
    h: true,
  };

  it('round-trips a minimal config', () => {
    const encoded = encodeConfig(minimalConfig);
    const decoded = decodeConfig(encoded);

    expect(decoded).toEqual(minimalConfig);
  });

  it('round-trips a full config with all optional fields', () => {
    const encoded = encodeConfig(fullConfig);
    const decoded = decodeConfig(encoded);

    expect(decoded).toEqual(fullConfig);
  });

  it('round-trips config with watchlist and username', () => {
    const cfg: PublicConfig = {
      u: 'alice',
      c: { popular: false, top250: false, watchlist: true },
      l: [],
      r: true,
    };
    const decoded = decodeConfig(encodeConfig(cfg));
    expect(decoded?.c.watchlist).toBe(true);
    expect(decoded?.u).toBe('alice');
  });

  it('forces watchlist to false when username is absent', () => {
    const cfg: PublicConfig = {
      c: { popular: false, top250: false, watchlist: true },
      l: [],
      r: false,
    };
    const decoded = decodeConfig(encodeConfig(cfg));
    expect(decoded?.c.watchlist).toBe(false);
  });

  it('returns null for malformed base64', () => {
    expect(decodeConfig('not-valid-json!!!')).toBeNull();
  });

  it('returns null for valid base64 with invalid schema', () => {
    const bad = Buffer.from(JSON.stringify({ unexpected: true })).toString('base64url');
    expect(decodeConfig(bad)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(decodeConfig('')).toBeNull();
  });

  it('rejects contributor IDs that violate regex constraint', () => {
    const cfg = {
      c: { popular: true, top250: false },
      l: [],
      f: [{ t: 'd', id: 'has spaces!' }],
      r: false,
    };
    const encoded = Buffer.from(JSON.stringify(cfg)).toString('base64url');
    expect(decodeConfig(encoded)).toBeNull();
  });

  it('produces a reasonably short encoded string for a realistic config', () => {
    const encoded = encodeConfig(fullConfig);
    expect(encoded.length).toBeLessThan(2000);
  });
});
