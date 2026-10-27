import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isSpecial, issueLabel, issueShortLabel, parseFilename } from '../src/metadata.ts';
import { validateIssueInput } from '../functions/api/_lib/validation.ts';

const special = { year: 2025, number: '00', serial: '0000' };
const regular = { year: 2000, number: '01', serial: '0066' };

test('number 00 marks the special issue', () => {
  assert.equal(isSpecial(special), true);
  assert.equal(isSpecial({ number: '0' }), true);
  assert.equal(isSpecial(regular), false);
  assert.equal(isSpecial({ number: '10' }), false);
});

test('the special issue is labelled «Спецвыпуск» instead of a number', () => {
  assert.equal(issueLabel(special), 'Спецвыпуск');
  assert.equal(issueShortLabel(special), 'Спецвыпуск');
  assert.equal(issueLabel(regular), '№ 01 (0066)');
  assert.equal(issueShortLabel(regular), '№ 01');
});

test('the censor file name of the special issue parses to 00 / 0000', () => {
  assert.deepEqual(parseFilename('ПП №00(0000)-01.06.2025.pdf'), { number: '00', serial: '0000', date: '2025-06-01' });
});

test('the server accepts 2025 but still rejects number 00 from uploads and years past 2025', () => {
  const input = { year: 2025, number: '01', serial: '0001', date: '2025-06-01', dateLabel: '1 июня 2025', filename: 'a.pdf', pages: 8 };
  assert.equal(validateIssueInput(input), '');
  assert.notEqual(validateIssueInput({ ...input, number: '00', serial: '0000' }), '');
  assert.notEqual(validateIssueInput({ ...input, year: 2026 }), '');
});
