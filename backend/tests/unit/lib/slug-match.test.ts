import { describe, it, expect } from 'vitest';
import { matchesSlug } from '../../../src/lib/slug-match.js';

describe('matchesSlug', () => {
  it('matche un slug qui correspond exactement au nom', () => {
    expect(matchesSlug('Top 250 Films by Women Directors', 'top-250-films-by-women-directors')).toBe(true);
  });

  it('ne matche pas un nom "voisin" qui ne diffère que par un chiffre (#135)', () => {
    // "Top 50 Horror Films by Women Directors" partageait 5/6 mots avec ce
    // slug (83%) sous l'ancien seuil de 80%, ce qui le faisait passer pour
    // "Top 250 Films by Women Directors".
    expect(matchesSlug('Top 50 Horror Films by Women Directors', 'top-250-films-by-women-directors')).toBe(false);
  });

  it('ne matche pas un nom "voisin" qui ne diffère que par un mot-catégorie (#135)', () => {
    // "Top 250 Films by Queer Directors" partageait 5/6 mots (83%) avec ce
    // slug sous l'ancien seuil, et l'emportait faussement sur "Black Directors".
    expect(matchesSlug('Top 250 Films by Queer Directors', 'top-250-films-by-black-directors')).toBe(false);
  });

  it('matche le bon nom parmi des listes au nommage template très proche', () => {
    expect(matchesSlug('Top 250 Films by Black Directors', 'top-250-films-by-black-directors')).toBe(true);
  });

  it('matche avec le suffixe de dédoublonnage Letterboxd ("-1", "-2")', () => {
    expect(matchesSlug('Monster High', 'monster-high-1')).toBe(true);
  });

  it('matche un slug avec un nombre faisant partie du titre ("apollo-13")', () => {
    expect(matchesSlug('Apollo 13', 'apollo-13')).toBe(true);
  });

  it('normalise les apostrophes et accents', () => {
    expect(matchesSlug("Women's Films", 'womens-films')).toBe(true);
  });

  it('tolère un slug tronqué qui est un sous-ensemble du nom', () => {
    expect(matchesSlug('Top 250 Films by Women Directors (Official)', 'top-250-films-by-women-directors')).toBe(true);
  });

  it('rejette un slug générique trop court par rapport à un nom long', () => {
    expect(matchesSlug('Top 250 Films by Women Directors', 'top-directors')).toBe(false);
  });

  it('matche un slug tronqué par Letterboxd (~43 car.) sur un nom très long (#158)', () => {
    expect(
      matchesSlug(
        'Psychosexual dramas, nihilistic fever dreams & surrealism with a touch of humour',
        'psychosexual-dramas-nihilistic-fever-dreams'
      )
    ).toBe(true);
    expect(
      matchesSlug(
        'Japanese Films That Will Blow Your Mind And Make You Reevaluate The Possibilities Of The Cinematic Artform',
        'japanese-films-that-will-blow-your-mind-and'
      )
    ).toBe(true);
  });

  it('un slug tronqué ne matche pas une autre liste au même début (#158)', () => {
    expect(
      matchesSlug(
        'Japanese Films That Will Blow Your Mind Away Forever Because Of Many Reasons And More',
        'japanese-films-that-will-blow-your-mind-and'
      )
    ).toBe(false);
  });

  it('rejette une liste totalement différente', () => {
    expect(matchesSlug('Unrelated List', 'top-250-films-by-women-directors')).toBe(false);
  });

  it('gère une liste vide de mots dans le slug', () => {
    expect(matchesSlug('Some List', '---')).toBe(false);
  });
});
