import { describe, it, expect } from 'vitest';
import { sanitizeUrlForLog } from '../../../src/lib/log-sanitize.js';

// The encoded preferences segment of a stateless install URL carries the member handle
// and the chosen list ids, so it must not reach the logs. Everything else stays, because
// the catalog id, pagination and hashed user id are what makes a log line diagnosable.
const ENCODED = 'eyJjIjp7InBvcHVsYXIiOmZhbHNlfSwibCI6WyI3b1VQUSJdLCJyIjp0cnVlfQ';
const USER_ID = 'fc3cb253ec31a45126edcabb3d38d7bd';

describe('sanitizeUrlForLog', () => {
  it('elides the encoded preferences segment', () => {
    expect(sanitizeUrlForLog(`/${ENCODED}/manifest.json`)).toBe('/[encoded]/manifest.json');
  });

  it('elides it in a catalog path and keeps the catalog id', () => {
    const out = sanitizeUrlForLog(`/${ENCODED}/catalog/movie/letterboxd-list-7oUPQ.json`);
    expect(out).toBe('/[encoded]/catalog/movie/letterboxd-list-7oUPQ.json');
    expect(out).not.toContain(ENCODED);
  });

  it('keeps the hashed user id of authenticated routes', () => {
    const url = `/stremio/${USER_ID}/catalog/movie/letterboxd-diary.json`;
    expect(sanitizeUrlForLog(url)).toBe(url);
  });

  it('leaves plain paths untouched', () => {
    expect(sanitizeUrlForLog('/catalog/movie/letterboxd-popular.json')).toBe(
      '/catalog/movie/letterboxd-popular.json',
    );
  });

  it('preserves the query string', () => {
    expect(sanitizeUrlForLog(`/${ENCODED}/catalog/movie/x.json?skip=100`)).toBe(
      '/[encoded]/catalog/movie/x.json?skip=100',
    );
  });

  it('handles the root path', () => {
    expect(sanitizeUrlForLog('/')).toBe('/');
  });
});
