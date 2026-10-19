// A list whose name has no Latin letters or digits (emoji, stylised Unicode,
// CJK…) gets the slug "filmlist:<n>" instead of a name-based one (#158).
// Its LID is <n> with the list type digit (2) appended, in base 62 — the same
// value the list page exposes as its boxd.it shortlink.
const FILMLIST_SLUG_REGEX = /^filmlist:(\d+)$/;
const BASE62 = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LIST_TYPE_DIGIT = 2n;

export function listIdFromSlug(slug: string): string | null {
  const match = slug.match(FILMLIST_SLUG_REGEX);
  if (!match) return null;

  let value = BigInt(match[1]!) * 10n + LIST_TYPE_DIGIT;
  let id = '';
  while (value > 0n) {
    id = BASE62[Number(value % 62n)] + id;
    value /= 62n;
  }
  return id;
}
