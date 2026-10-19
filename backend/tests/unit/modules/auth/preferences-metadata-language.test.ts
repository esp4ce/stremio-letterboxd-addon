import { describe, it, expect } from 'vitest';
import { preferencesBodySchema } from '../../../../src/modules/auth/auth.schemas.js';

const base = {
  catalogs: { watchlist: true, diary: true, friends: true, popular: true, top250: true, likedFilms: false, recommended: false },
  ownLists: [],
  externalLists: [],
};

describe('preferences: metadataLanguage', () => {
  it('keeps a supported metadata language', () => {
    const parsed = preferencesBodySchema.parse({ preferences: { ...base, metadataLanguage: 'fr-FR' } });
    expect(parsed.preferences.metadataLanguage).toBe('fr-FR');
  });

  it.each(['xx-YY', 'fr', 'ar-SA'])('rejects the unsupported language %s', (metadataLanguage) => {
    expect(preferencesBodySchema.safeParse({ preferences: { ...base, metadataLanguage } }).success).toBe(false);
  });

  it('leaves metadataLanguage absent when not sent', () => {
    expect(preferencesBodySchema.parse({ preferences: base }).preferences.metadataLanguage).toBeUndefined();
  });
});
