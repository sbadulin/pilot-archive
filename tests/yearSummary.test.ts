import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yearMonthsLabel } from '../src/metadata.ts';

const dated = (...dates: string[]) => dates.map((date) => ({ date }));

test('a year spanning several months names the first and last month', () => {
  assert.equal(yearMonthsLabel(dated('2000-03-29', '2000-01-05', '2000-08-30')), 'Январь–август');
});

test('a year with issues from one month names just that month', () => {
  assert.equal(yearMonthsLabel(dated('2002-12-01')), 'Декабрь');
});

test('a year without dated issues has no label', () => {
  assert.equal(yearMonthsLabel([]), '');
  assert.equal(yearMonthsLabel(dated('')), '');
});
