import { describe, it, expect } from 'vitest';
import { withNativeSync } from '../../src/lib/native-sync';
import type { UserPreferences } from '../../src/types/preferences';

const prefs: UserPreferences = {
  catalogs: { watchlist: true, diary: false, friends: false, popular: false, top250: false, likedFilms: false, recommended: false },
  ownLists: [],
  externalLists: [],
};

describe('withNativeSync', () => {
  it('captures the browser timezone when turned on', () => {
    expect(withNativeSync(prefs, true, 'Europe/Paris')).toMatchObject({ nativeSync: true, timezone: 'Europe/Paris' });
  });

  it('keeps the stored timezone when turned off', () => {
    const on = withNativeSync(prefs, true, 'Europe/Paris');
    expect(withNativeSync(on, false, 'America/New_York')).toMatchObject({ nativeSync: false, timezone: 'Europe/Paris' });
  });

  it('turns on without a timezone when the browser gives none', () => {
    const result = withNativeSync(prefs, true, undefined);
    expect(result.nativeSync).toBe(true);
    expect(result.timezone).toBeUndefined();
  });
});
