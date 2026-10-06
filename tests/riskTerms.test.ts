import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRisks, mentionsMinor, recommendAction } from '../src/riskTerms.ts';

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

test('ages under 18 and school words mark a minor', () => {
  assert.ok(mentionsMinor('Скарлетт (15) и Мей (14/160).'));
  assert.ok(mentionsMinor('ищет друга не младше 17 лет'));
  assert.ok(mentionsMinor('Петька из 8 класса'));
  assert.ok(mentionsMinor('Я девятиклассница'));
  assert.ok(mentionsMinor('Школьники на каникулах'));
});

test('adult ages, years and page numbers do not mark a minor', () => {
  assert.ok(!mentionsMinor('Ей 23 года'));
  assert.ok(!mentionsMinor('Это было 18 лет назад'));
  assert.ok(!mentionsMinor('Д-539, Видео 102 мин.'));
  assert.ok(!mentionsMinor('стр. 12, 2000 год'));
});

test('actions follow the law: always banned, 18+ allowed, minors redacted', () => {
  const action = (text: string) => recommendAction(findRisks(text), mentionsMinor(text));
  assert.equal(action('Наркотики и мы'), 'redact');
  assert.equal(action('Две сексуальные девушки'), 'adult');
  assert.equal(action('Две сексуальные девушки, нам по 15 лет'), 'redactMinor');
  assert.equal(action('Уроки охмурения для школьниц'), 'lawyer');
  assert.equal(action('Уроки охмурения'), 'review');
  assert.equal(action('Это пиздец'), 'lawyer');
});

test('politics sends an article to be read, weak political words only to a look', () => {
  const action = (text: string) => recommendAction(findRisks(text), mentionsMinor(text));
  assert.equal(action('«Мы подождём, что скажет Путин...»'), 'politics');
  assert.equal(action('Дедовщина в нашей части'), 'politics');
  assert.equal(action('Письмо из Чечни'), 'politics');
  assert.equal(action('Солдат вернулся домой'), 'review');
  assert.equal(action('Тринадцатый воин'), 'review');
  assert.deepEqual(categories('Когда мы увидим «Властелина колец»?'), []);
  assert.deepEqual(categories('при Советской власти'), ['politics?']);
});

test('the excerpt keeps the original spelling around the match', () => {
  const [match] = findRisks('Начало. Затем — Наркотики и всё такое. Конец.');
  assert.match(match.excerpt, /Наркотики и всё такое/);
});
