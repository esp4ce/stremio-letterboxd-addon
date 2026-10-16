function extractWords(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[''ʼ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0);
}

function wordsOverlap(nameWords: string[], slugWords: string[]): boolean {
  const nameSet = new Set(nameWords);
  const slugSet = new Set(slugWords);
  const slugInName = slugWords.filter((w) => nameSet.has(w)).length;
  const nameInSlug = nameWords.filter((w) => slugSet.has(w)).length;

  // Every word in the URL slug must appear in the list name (100%, not a
  // partial threshold). A partial threshold here previously let
  // "top-250-..." match "Top 50 ..." (5/6 shared words = 83%) and
  // "...by-black-directors" match "...by Queer Directors" (5/6 = 83%) —
  // near-duplicate official lists sharing a template differ by exactly the
  // one word this threshold used to tolerate. Truncated/custom slugs
  // (fewer words than the name) still match since we only require slug
  // words to be a subset of the name's words.
  //
  // nameInSlug keeps the original 60% floor so a short/generic slug
  // ("top-directors") can't match an unrelated, much longer name.
  return slugInName === slugWords.length
      && nameInSlug >= nameWords.length * 0.6;
}

/** Match a list name against a URL slug using word-subset matching */
// Letterboxd cuts list slugs at ~43 chars, so a long name yields a slug that
// is only a prefix of the name's own slug (#158).
const TRUNCATED_SLUG_MIN_LENGTH = 40;

export function matchesSlug(listName: string, urlSlug: string): boolean {
  const nameWords = extractWords(listName);
  const slugWords = urlSlug.split('-').filter((w) => w.length > 0);

  if (slugWords.length === 0) return false;
  if (wordsOverlap(nameWords, slugWords)) return true;
  if (
    urlSlug.length >= TRUNCATED_SLUG_MIN_LENGTH &&
    `${nameWords.join('-')}-`.startsWith(`${slugWords.join('-')}-`)
  ) {
    return true;
  }

  // Retry without trailing number — Letterboxd dedup suffix ("monster-high-1")
  const stripped = urlSlug.replace(/-\d+$/, '');
  if (stripped !== urlSlug) {
    const strippedWords = stripped.split('-').filter((w) => w.length > 0);
    if (strippedWords.length === 0) return false;
    return wordsOverlap(nameWords, strippedWords);
  }

  return false;
}
