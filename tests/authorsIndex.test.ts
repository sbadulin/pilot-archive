import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeAuthorsIndex, type CreditRow } from '../functions/api/_lib/authorsIndex.ts';

const row = (overrides: Partial<CreditRow> = {}): CreditRow => ({
  year: 2000, number: '26', serial: '0091', page: 7, kind: 'article', title: 'Кидайте их, пацаны!', name: 'Князь Тишины', nameKey: 'князь тишины',
  ...overrides,
});

test('credits of one spelling become one search variant linking to issue pages', () => {
  const { names } = composeAuthorsIndex([
    row(),
    row({ number: '24', serial: '0089', page: 3, title: 'Другое', name: 'КНЯЗЬ ТИШИНЫ' }),
  ], 1);
  assert.equal(names.length, 1);
  assert.equal(names[0].key, 'князь тишины');
  assert.deepEqual(names[0].credits.map((c) => [c.issue, c.page]), [['2000-24-0089', 3], ['2000-26-0091', 7]]);
});

test('a nick\'s own spelling stays a separate variant', () => {
  const { names } = composeAuthorsIndex([
    row({ name: 'Svetk@', nameKey: 'svetka' }),
    row({ name: 'Svetka', nameKey: 'svetka', page: 8 }),
  ], 1);
  assert.deepEqual(names.map((n) => n.name).sort(), ['Svetka', 'Svetk@'].sort());
});

test('the most frequent spelling names the variant', () => {
  const { names } = composeAuthorsIndex([
    row({ name: 'ЛЯНА', page: 1 }), row({ name: 'Ляна', page: 2 }), row({ name: 'Ляна', page: 3 }),
  ].map((r) => ({ ...r, nameKey: 'ляна' })), 1);
  assert.equal(names[0].name, 'Ляна');
});

test('the same material is listed once per variant', () => {
  const { names } = composeAuthorsIndex([row(), row()], 1);
  assert.equal(names[0].credits.length, 1);
});
