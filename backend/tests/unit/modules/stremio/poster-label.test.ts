import { describe, it, expect } from 'vitest';
import { sanitizePosterLabel } from '../../../../src/modules/stremio/poster.service.js';

describe('sanitizePosterLabel', () => {
  it('keeps a plain display name as is', () => {
    expect(sanitizePosterLabel('Joel Haver')).toBe('Joel Haver');
  });

  it('keeps accents, stars and the half star', () => {
    expect(sanitizePosterLabel('Zoé · ★★★½')).toBe('Zoé · ★★★½');
  });

  it('keeps the ellipsis of an already shortened name', () => {
    expect(sanitizePosterLabel('Alexandrina M… · ★★★★')).toBe('Alexandrina M… · ★★★★');
  });

  it('strips everything that could inject SVG markup', () => {
    const out = sanitizePosterLabel('<script>alert(1)</script>"&\'');
    expect(out).not.toMatch(/[<>"'&]/);
  });

  it('truncates with an ellipsis past the limit', () => {
    const out = sanitizePosterLabel('A'.repeat(60));
    expect(out.length).toBeLessThanOrEqual(24);
    expect(out.endsWith('…')).toBe(true);
  });

  it('drops characters the overlay font cannot draw (CJK, emoji) but keeps the rest', () => {
    expect(sanitizePosterLabel('Joel 日本語 🎬')).toBe('Joel');
  });

  it('falls back to "Friend" when nothing renderable is left', () => {
    expect(sanitizePosterLabel('日本語')).toBe('Friend');
    expect(sanitizePosterLabel('   ')).toBe('Friend');
  });

  it('strips control characters', () => {
    expect(sanitizePosterLabel('Jo\u0000el\n')).toBe('Joel');
  });
});
