import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorHref, linkedAuthor } from '../src/authorLink.ts';
import { linkedEntry } from '../src/authorSearch.ts';
import { normalizeName } from '../src/authorNames.ts';

const entry = (name: string, ...spellings: string[]) => {
  const keys = [name, ...spellings].map(normalizeName);
  return { name, key: keys[0], keys, aliases: spellings, credits: [{ issue: '2000-01-0066', page: 1, kind: 'drawing', title: null }] };
};

test('a direct author link reads as the name and comes back as it', () => {
  assert.equal(authorHref('Захар Веселов'), '/?author=Захар+Веселов');
  assert.equal(authorHref('A&B #1'), '/?author=A%26B+%231');
  assert.equal(linkedAuthor('?author=Захар+Веселов'), 'Захар Веселов');
  assert.equal(linkedAuthor(new URL(`https://x${authorHref('A&B #1')}`).search), 'A&B #1');
  assert.equal(linkedAuthor('?author=+'), null);
  assert.equal(linkedAuthor(''), null);
});

test('a link opens the author with that name, or the only match, never a guess among several', () => {
  const names = [entry('Захар ВЕСЕЛОВ', 'Злат (Захар ВЕСЕЛОВ)'), entry('Павел ТРУТНЕВ'), entry('Павел О\'Брайен ГЛЫБА')];
  assert.equal(linkedEntry(names, 'Захар Веселов')?.name, 'Захар ВЕСЕЛОВ', 'case aside');
  assert.equal(linkedEntry(names, 'Веселов')?.name, 'Захар ВЕСЕЛОВ', 'the only match');
  assert.equal(linkedEntry(names, 'Павел'), null, 'two Павел: the list to choose from');
});
