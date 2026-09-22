import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupSpreads, printedPages } from '../src/readerLayout.ts';
import { parseFilename, validateMetadata, issues, issuePdfUrl, scanUrl } from '../src/metadata.ts';
import { roleForEmail, canPublish } from '../src/ingestion.ts';

test('front and back covers remain single in even and odd documents', () => {
  assert.deepEqual(groupSpreads(6), [[1], [2, 3], [4, 5], [6]]);
  assert.deepEqual(groupSpreads(5), [[1], [2, 3], [4], [5]]);
  assert.deepEqual(groupSpreads(1), [[1]]);
  assert.deepEqual(groupSpreads(0), []);
});
test('large sheets remain single; every page appears exactly once', () => {
  for (let count = 1; count <= 32; count++) {
    const groups = groupSpreads(count, [8]);
    assert.deepEqual(groups.flat(), Array.from({ length: count }, (_, i) => i + 1));
    assert.ok(groups.every(group => !group.includes(8) || group.length === 1));
  }
});
test('large sheets hold two printed pages, shifting the numbers after them', () => {
  const layout = printedPages(15, [10]);
  assert.equal(layout.total, 16);
  assert.equal(layout.label(9), '9');
  assert.equal(layout.label(10), '10–11');
  assert.equal(layout.label(11), '12');
  assert.equal(layout.label(15), '16');
  assert.equal(layout.first(11), 12);
  assert.equal(layout.sheetFor(10), 10);
  assert.equal(layout.sheetFor(11), 10);
  assert.equal(layout.sheetFor(12), 11);
  assert.equal(layout.sheetFor(99), 15);
  assert.equal(printedPages(6).label(4), '4');
  assert.equal(printedPages(6).total, 6);
});
test('all recovered issue identities and file names parse correctly', () => {
  assert.equal(issues.length, 8);
  assert.equal(new Set(issues.map(i => i.id)).size, 8);
  for (const issue of issues) {
    assert.equal(validateMetadata(issue.date, issue.number, issue.serial), '');
    assert.match(issuePdfUrl(issue), /^\/archive\/.+\/issue.pdf$/);
    assert.match(scanUrl(issue), /cover.jpg$/);
  }
  assert.deepEqual(parseFilename('ПП №03(0068)-19.01.2000.pdf'), { number: '03', serial: '0068', date: '2000-01-19' });
  assert.notEqual(validateMetadata('2000-02-30', '1', '66'), '');
});
test('public submissions never grant curator privileges; bans override roles', () => {
  const env = { CURATOR_EMAILS: 'curator@example.com', VOLUNTEER_EMAILS: 'volunteer@example.com', PUBLIC_SUBMISSIONS: 'true', BANNED_EMAILS: 'blocked@example.com' };
  assert.equal(canPublish(roleForEmail('stranger@example.com', env)), false);
  assert.equal(canPublish(roleForEmail('curator@example.com', env)), true);
  assert.equal(roleForEmail('blocked@example.com', env), null);
  assert.equal(roleForEmail(null, env), null);
});
