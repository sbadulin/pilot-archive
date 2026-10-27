import { normalizeName } from './authorNames.ts';
import type { IndexName } from '../functions/api/_lib/authorsIndex.ts';

export const MIN_QUERY = 3;

// Levenshtein distance capped at 2: enough to tell "one typo" from "different word".
function withinOneEdit(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else { i++; j++; }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

// A query word matches a name word by its start, or with one typo when it is 5+ letters long.
const wordMatches = (query: string, word: string) =>
  word.startsWith(query) || (query.length >= 5 && withinOneEdit(query, word.slice(0, Math.max(query.length, word.length))));

// normalizeName folds B, H, T into Cyrillic only as capitals, so «bad» and «BAD» got different keys.
// Stored keys can't change (D1 credits and the published index use them); fold the rest when comparing.
const LOWER_LOOKALIKES: Record<string, string> = { b: 'в', h: 'н', t: 'т' };
const foldCase = (key: string) => key.replace(/[bht]/g, (ch) => LOWER_LOOKALIKES[ch]);

// True when every query word matches some word of one of the name's search keys.
export function matchesQuery(query: string, keys: string[]): boolean {
  const words = foldCase(normalizeName(query)).split(' ').filter(Boolean);
  if (words.join('').length < MIN_QUERY) return false;
  return keys.some((key) => {
    const nameWords = foldCase(key).split(' ');
    return words.every((q) => nameWords.some((w) => wordMatches(q, w)));
  });
}

export function searchNames(names: IndexName[], query: string, limit = 8): IndexName[] {
  return names
    // Any spelling folded into the entry finds it.
    .filter((entry) => matchesQuery(query, entry.keys ?? [entry.key]))
    .sort((a, b) => b.credits.length - a.credits.length || a.key.localeCompare(b.key, 'ru'))
    .slice(0, limit);
}
