import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchNames } from '../src/authorSearch.ts';
import { normalizeName } from '../src/authorNames.ts';
import type { IndexName } from '../functions/api/_lib/authorsIndex.ts';

const entry = (name: string, key: string, count = 1): IndexName => ({
  name, key, credits: Array.from({ length: count }, (_, i) => ({ issue: '2000-26-0091', page: i + 1, kind: 'article', title: null })),
});
const names = [
  entry('Князь Тишины', 'князь тишины', 2),
  entry('Лариса КОХАН', 'лариса кохан'),
  entry('Svetk@', normalizeName('Svetk@')),
  entry('Васисуалий ЛОПАТА', 'васисуалий лопата', 3),
];

test('one letter finds nothing; two letters find only a word of exactly those letters', () => {
  const short = [...names, entry('ПТ', normalizeName('ПТ')), entry('ПП', normalizeName('ПП')), entry('Пт и компания', normalizeName('Пт и компания'))];
  assert.deepEqual(searchNames(short, 'т'), []);
  assert.deepEqual(searchNames(short, 'ти'), []);
  assert.deepEqual(searchNames(short, 'пт').map((n) => n.name).sort(), ['ПТ', 'Пт и компания']);
  assert.deepEqual(searchNames(short, 'ПП').map((n) => n.name), ['ПП']);
});

test('a query matches the start of any word, case and ё aside', () => {
  assert.deepEqual(searchNames(names, 'тиш').map((n) => n.name), ['Князь Тишины']);
  assert.deepEqual(searchNames(names, 'КОХ').map((n) => n.name), ['Лариса КОХАН']);
});

test('every query word must match', () => {
  assert.deepEqual(searchNames(names, 'князь тиш').map((n) => n.name), ['Князь Тишины']);
  assert.deepEqual(searchNames(names, 'князь лоп'), []);
});

test('Latin nicks are found by how they sound in either alphabet', () => {
  assert.deepEqual(searchNames(names, 'svetka').map((n) => n.name), ['Svetk@']);
});

test('Latin nicks are found whatever the case of the query or of the name', () => {
  const nicks = [entry('BAD', normalizeName('BAD')), entry('DJ SASH!', normalizeName('DJ SASH!')), entry('Hot Tina', normalizeName('Hot Tina'))];
  for (const query of ['bad', 'BAD', 'Bad', 'bAd']) assert.deepEqual(searchNames(nicks, query).map((n) => n.name), ['BAD'], query);
  assert.deepEqual(searchNames(nicks, 'dj sash').map((n) => n.name), ['DJ SASH!']);
  assert.deepEqual(searchNames(nicks, 'HOT TINA').map((n) => n.name), ['Hot Tina']);
  assert.deepEqual(searchNames(nicks, 'hot tina').map((n) => n.name), ['Hot Tina']);
});

test('one typo is forgiven in words of five letters or more', () => {
  assert.deepEqual(searchNames(names, 'васисулий').map((n) => n.name), ['Васисуалий ЛОПАТА']);
  assert.deepEqual(searchNames(names, 'кохн'), []);
});

test('names with more materials come first', () => {
  const found = searchNames([entry('Катя', 'катя', 1), entry('Катя Иващенко', 'катя иващенко', 4)], 'кат');
  assert.deepEqual(found.map((n) => n.name), ['Катя Иващенко', 'Катя']);
});
