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

export function searchNames(names: IndexName[], query: string, limit = 8): IndexName[] {
  const words = normalizeName(query).split(' ').filter(Boolean);
  if (words.join('').length < MIN_QUERY) return [];
  return names
    .filter((entry) => {
      // Any spelling folded into the entry finds it.
      return (entry.keys ?? [entry.key]).some((key) => {
        const nameWords = key.split(' ');
        return words.every((q) => nameWords.some((w) => wordMatches(q, w)));
      });
    })
    .sort((a, b) => b.credits.length - a.credits.length || a.key.localeCompare(b.key, 'ru'))
    .slice(0, limit);
}
