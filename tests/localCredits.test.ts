import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bylineEntries, captionEntries, closuresFrom, isClosed, sheetResult } from '../src/localCredits.ts';
import { creditsFromSheet } from '../src/authorNames.ts';

const sheet = {
  pageType: 'regular',
  articles: [
    { kind: 'article', title: '«Праздник кончился, ДОБРЫЕ ЛЮДИ!»', byline: 'Вопросы задавала\nЛЯНА', text: '…' },
    { kind: 'letter', rubric: 'Строки из конверта', title: null, byline: 'Тарас', text: '…' },
    { kind: 'ad', title: 'Магазин', byline: 'ООО «Ромашка»', text: '…' },
    { kind: 'caption', title: null, byline: null, text: 'Фото Ивана Петрова' },
    { kind: 'caption', title: null, byline: null, text: 'Группа на сцене' },
    { kind: 'letter', title: 'Анкета', byline: 'Лена Вяткина, 14 лет', text: '…' },
  ],
};

test('takes signed articles and letters, not ads, and keeps the rubric as a title', () => {
  assert.deepEqual(
    bylineEntries(3, sheet).map((entry) => [entry.id, entry.kind, entry.title, entry.byline]),
    [
      ['3-0', 'article', '«Праздник кончился, ДОБРЫЕ ЛЮДИ!»', 'Вопросы задавала ЛЯНА'],
      ['3-1', 'letter', 'Строки из конверта', 'Тарас'],
      ['3-5', 'letter', 'Анкета', 'Лена Вяткина, 14 лет'],
    ],
  );
  assert.deepEqual(captionEntries(3, sheet).map((entry) => entry.id), ['3-3']);
});

test('pager and TV sheets give nothing, like the approval prompt', () => {
  assert.deepEqual(bylineEntries(12, { ...sheet, pageType: 'pager' }), []);
  assert.deepEqual(captionEntries(10, { ...sheet, pageType: 'tv' }), []);
});

test('a byline the censor closed stays out of the search', () => {
  const closures = closuresFrom(
    [
      { sheet: 3, find: 'Вяткина', approved: true },
      { sheet: 7, article: 'Строки из конверта', approved: true },
      { sheet: 3, find: 'Тарас', approved: false },
    ],
    [{ name: 'Путин' }],
  );
  assert.ok(isClosed(3, 'Анкета', 'Лена Вяткина, 14 лет', closures));
  assert.ok(!isClosed(4, 'Анкета', 'Лена Вяткина, 14 лет', closures), 'a phrase closes only on its own sheet');
  assert.ok(isClosed(7, 'Строки из конверта', 'Тарас', closures));
  assert.ok(!isClosed(3, 'Строки из конверта', 'Тарас', closures), 'an undecided item closes nothing');
  assert.ok(isClosed(9, null, 'В. Путину', closures), 'a global surname closes everywhere');
});

test('the stored sheet reads like an approval recognition', () => {
  const closures = closuresFrom([{ sheet: 3, find: 'Вяткина', approved: true }]);
  const result = sheetResult(3, sheet, closures, { '3-0': ['ЛЯНА'], '3-1': ['Тарас'], '3-5': ['Лена Вяткина'] }, { '3-3': [{ kind: 'photo', name: 'Иван Петров' }] });
  assert.equal(result.pageType, 'regular');
  assert.deepEqual(result.articles.map((article) => article.authors), [['ЛЯНА'], ['Тарас']]);
  const credits = creditsFromSheet(result, { year: 2000, number: '46', serial: '0111', sheet: 3, printedPage: 3, source: 'claude-code-local' });
  assert.deepEqual(credits.map((credit) => [credit.kind, credit.name]), [['article', 'ЛЯНА'], ['letter', 'Тарас'], ['photo', 'Иван Петров']]);
});

test('a closed name in a caption stays out even after the model changes its case', () => {
  const closures = closuresFrom([{ sheet: 3, find: 'Ивана Петрова', approved: true }]);
  const result = sheetResult(3, sheet, closures, {}, { '3-3': [{ kind: 'photo', name: 'Иван Петров' }] });
  assert.deepEqual(result.credits, []);
});

test('a byline without a clean name is dropped instead of becoming a name', () => {
  const result = sheetResult(3, sheet, [], { '3-0': [] }, {});
  assert.deepEqual(result.articles, []);
});
