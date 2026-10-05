import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRisks } from '../src/riskTerms.ts';

const categories = (text: string) => findRisks(text).map(match => `${match.category}${match.weak ? '?' : ''}`);

test('stems match inflected words from the start of a word', () => {
  assert.deepEqual(categories('Наркоманы во дворе'), ['drugs']);
  assert.deepEqual(categories('Этот раздел я отношу к садомазо'), ['sexual']);
  assert.deepEqual(categories('ВСЁ О СУИЦИДЕ'), ['suicide']);
});

test('stems do not match inside other words', () => {
  assert.deepEqual(categories('Моральные устои и канальная крыса'), []);
  assert.deepEqual(categories('Лимонная кислота и травма колена'), []);
});

test('whole-word terms do not match longer words', () => {
  assert.deepEqual(categories('Японская гейша'), []);
  assert.deepEqual(categories('Он гей'), ['lgbt']);
  assert.deepEqual(categories('Э-ге-гей!!! Три девчонки'), []);
});

test('blue eyes in pen-pal ads are not flagged', () => {
  assert.deepEqual(categories('Голубоглазая блондинка с серо-голубыми глазами'), []);
  assert.deepEqual(categories('ЯНА «Одинокий голубь»'), []);
});

test('slang stems from real headlines are caught', () => {
  assert.deepEqual(categories('НА ОБКУРКУ СТАНОВИСЬ?'), ['drugs']);
});

test('multi-word terms survive line breaks and ё', () => {
  assert.deepEqual(categories('решил покончить\nс собой'), ['suicide']);
  assert.deepEqual(categories('СВЕСТИ СЧЁТЫ С ЖИЗНЬЮ'), ['suicide']);
});

test('weak terms are marked and give way to strong ones of the same category', () => {
  assert.deepEqual(categories('Голубые береты'), ['lgbt?']);
  assert.deepEqual(categories('Голубой — значит гомосексуалист'), ['lgbt']);
});

test('overlapping terms of one category count once, other categories stay', () => {
  assert.deepEqual(categories('наркоманы'), ['drugs']);
  assert.deepEqual(categories('сексуальных меньшинств'), ['lgbt', 'sexual']);
});

test('the excerpt keeps the original spelling around the match', () => {
  const [match] = findRisks('Начало. Затем — Наркотики и всё такое. Конец.');
  assert.match(match.excerpt, /Наркотики и всё такое/);
});
