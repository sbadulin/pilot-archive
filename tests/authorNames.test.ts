import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyNameFix, creditsFromSheet, normalizeName, similarNames, variantKey } from '../src/authorNames.ts';

test('names one letter apart in a long word are similar', () => {
  assert.ok(similarNames('Васиуалий ЛОПАТА', 'Васисуалий ЛОПАТА'));
  assert.ok(similarNames('Катарина', 'КАТЕРИНА'));
  assert.ok(similarNames('Валери', 'Валерия'));
});

test('short words, other words and deliberate nick spellings are not similar', () => {
  assert.ok(!similarNames('Каня', 'Катя'));
  assert.ok(!similarNames('Svetk@', 'Svetka'));
  assert.ok(!similarNames('Константин ЛУКОНИН', 'Константин ПЕЛЫХ'));
  assert.ok(!similarNames('Валерия', 'Валерия Иванова'));
});

test('name fixes replace a misread name by its variant key', () => {
  const fixes = { 'Васиуалий ЛОПАТА': 'Васисуалий ЛОПАТА' };
  assert.equal(applyNameFix('ВАСИУАЛИЙ Лопата.', fixes), 'Васисуалий ЛОПАТА');
  assert.equal(applyNameFix('Лариса КОХАН', fixes), 'Лариса КОХАН');
});

test('search variants keep a nick\'s own spelling but not its case or trailing dot', () => {
  assert.notEqual(variantKey('Svetk@'), variantKey('Svetka'));
  assert.notEqual(variantKey('K.O.T.T.'), variantKey('К.О.Т.Т.'));
  assert.equal(variantKey('КНЯЗЬ ТИШИНЫ'), variantKey('Князь  Тишины.'));
  assert.equal(variantKey('Ёжик'), variantKey('ежик'));
});

test('case and ё do not split one name', () => {
  assert.equal(normalizeName('КНЯЗЬ ТИШИНЫ'), normalizeName('Князь Тишины'));
  assert.equal(normalizeName('Ёжик Unfogiven'), normalizeName('ежик Unfogiven'));
});

test('Latin lookalikes and Cyrillic give one key', () => {
  assert.equal(normalizeName('K.O.T.T.'), normalizeName('К.О.Т.Т.'));
  assert.equal(normalizeName('BOY'), normalizeName('ВОУ'));
});

test('punctuation and quotes are ignored, @ reads as а', () => {
  assert.equal(normalizeName('«МОЛОДОЙ»'), 'молодой');
  assert.equal(normalizeName('Svetk@'), normalizeName('Svetka'));
  assert.equal(normalizeName('  Живой   ДРУП. '), 'живой друп');
});

const context = { year: 2000, number: '26', serial: '0091', sheet: 7, printedPage: 7, source: 'google/gemini-3.8-flash' };

test('each author of a joint byline becomes a credit', () => {
  const credits = creditsFromSheet({
    articles: [{ title: 'Кидайте их, пацаны!', byline: 'Князь Тишины & Punisher', authors: ['Князь Тишины', 'Punisher'], kind: 'article' }],
  }, context);
  assert.deepEqual(credits.map((c) => c.name), ['Князь Тишины', 'Punisher']);
  assert.ok(credits.every((c) => c.byline === 'Князь Тишины & Punisher' && c.printedPage === 7));
});

test('unsigned materials give no credits; a byline without names falls back to the byline', () => {
  const credits = creditsFromSheet({
    articles: [
      { title: 'Без подписи', byline: null, authors: [] },
      { title: 'Ценные советы', byline: 'К.', authors: [] },
    ],
  }, context);
  assert.deepEqual(credits.map((c) => c.name), ['К.']);
});

test('photo and drawing credits keep their kind', () => {
  const credits = creditsFromSheet({ articles: [], credits: [{ kind: 'photo', name: 'Захар Веселов' }] }, context);
  assert.deepEqual(credits.map((c) => [c.kind, c.name]), [['photo', 'Захар Веселов']]);
});

test('line breaks in a byline become spaces', () => {
  const [credit] = creditsFromSheet({ articles: [{ title: 'x', byline: 'Князь Тишины\n& Punisher', authors: ['Князь Тишины'] }] }, context);
  assert.equal(credit.byline, 'Князь Тишины & Punisher');
});

test('duplicate names within one material are dropped', () => {
  const credits = creditsFromSheet({
    articles: [{ title: 'x', byline: 'ЛЯНА', authors: ['ЛЯНА', 'Ляна'] }],
  }, context);
  assert.equal(credits.length, 1);
});
