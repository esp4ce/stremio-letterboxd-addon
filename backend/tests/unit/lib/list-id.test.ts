import { describe, it, expect } from 'vitest';
import { listIdFromSlug } from '../../../src/lib/list-id.js';

describe('listIdFromSlug', () => {
  // Real pairs: filmlist slug number ↔ boxd.it LID read from the list page (#158)
  it('convertit un slug filmlist:<n> en LID', () => {
    expect(listIdFromSlug('filmlist:28697007')).toBe('jq61y');
    expect(listIdFromSlug('filmlist:4204597')).toBe('2Qq4Q');
    expect(listIdFromSlug('filmlist:207314')).toBe('8HjM');
  });

  it('retourne null pour un slug classique', () => {
    expect(listIdFromSlug('my-cool-list')).toBeNull();
    expect(listIdFromSlug('filmlist')).toBeNull();
    expect(listIdFromSlug('filmlist:abc')).toBeNull();
    expect(listIdFromSlug('filmlist:')).toBeNull();
  });
});
