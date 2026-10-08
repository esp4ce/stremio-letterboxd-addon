import { describe, it, expect } from 'vitest';
import { preferencesBodySchema } from '../../../../src/modules/auth/auth.schemas.js';

const base = {
  catalogs: { watchlist: true, diary: true, friends: true, popular: true, top250: true, likedFilms: false, recommended: false },
  ownLists: [],
  externalLists: [],
};

describe('preferences: native sync fields', () => {
  it('keeps nativeSync and a valid IANA timezone', () => {
    const parsed = preferencesBodySchema.parse({ preferences: { ...base, nativeSync: true, timezone: 'Europe/Paris' } });
    expect(parsed.preferences.nativeSync).toBe(true);
    expect(parsed.preferences.timezone).toBe('Europe/Paris');
  });

  it('drops an invalid timezone instead of rejecting the save', () => {
    const parsed = preferencesBodySchema.parse({ preferences: { ...base, nativeSync: true, timezone: 'Mars/Olympus' } });
    expect(parsed.preferences.timezone).toBeUndefined();
    expect(parsed.preferences.nativeSync).toBe(true);
  });

  it('leaves nativeSync absent when not sent (off by default)', () => {
    expect(preferencesBodySchema.parse({ preferences: base }).preferences.nativeSync).toBeUndefined();
  });
});
