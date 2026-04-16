import { describe, it, expect } from 'vitest';
import { parseLetterboxdListUrl } from '../../../../src/modules/letterboxd/letterboxd.service.js';

describe('parseLetterboxdListUrl', () => {
  it('parse une URL complète avec trailing slash', () => {
    const result = parseLetterboxdListUrl('https://letterboxd.com/testuser/list/my-cool-list/');
    expect(result).toEqual({ username: 'testuser', slug: 'my-cool-list' });
  });

  it('parse une URL sans trailing slash', () => {
    const result = parseLetterboxdListUrl('https://letterboxd.com/testuser/list/my-cool-list');
    expect(result).toEqual({ username: 'testuser', slug: 'my-cool-list' });
  });

  it('parse une URL sans protocole', () => {
    const result = parseLetterboxdListUrl('letterboxd.com/testuser/list/my-list/');
    expect(result).toEqual({ username: 'testuser', slug: 'my-list' });
  });

  it('parse une URL avec www', () => {
    const result = parseLetterboxdListUrl('https://www.letterboxd.com/testuser/list/my-list/');
    expect(result).toEqual({ username: 'testuser', slug: 'my-list' });
  });

  it('retourne null pour une URL non-list', () => {
    expect(parseLetterboxdListUrl('https://letterboxd.com/testuser/films/')).toBeNull();
  });

  it('retourne null pour une chaîne vide', () => {
    expect(parseLetterboxdListUrl('')).toBeNull();
  });

  it('retourne null pour une URL aléatoire', () => {
    expect(parseLetterboxdListUrl('https://example.com/foo/bar')).toBeNull();
  });
});
