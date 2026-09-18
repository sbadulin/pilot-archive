import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { composeManifest, type SubmissionRow } from '../functions/api/_lib/manifest.ts';
import { baseCatalog } from '../functions/api/_lib/baseCatalog.ts';

const publicBase = 'https://pilot-archive.ru';
const submission = (overrides: Partial<SubmissionRow> = {}): SubmissionRow => ({
  id: '5b2242b9-3be2-4e17-91b0-ae65edee31ec',
  year: 2000,
  number: '11',
  serial: '0076',
  date: '2000-03-15',
  dateLabel: '15 марта 2000 г.',
  pages: 19,
  filename: 'ПП №11(0076)-15.03.2000.pdf',
  storageKey: 'submissions/2000/issue-11-0076/5b2242b9-3be2-4e17-91b0-ae65edee31ec.pdf',
  ...overrides,
});

test('base catalog matches the archive catalog shipped in the repository', async () => {
  const manifest = JSON.parse(await readFile('archive-catalog/manifest.json', 'utf8'));
  assert.deepEqual(baseCatalog, manifest.issues);
});

test('approving the first submission keeps every migrated issue', () => {
  const { issues } = composeManifest(baseCatalog, [submission()], publicBase);
  assert.equal(issues.length, baseCatalog.length + 1);
  for (const original of baseCatalog)
    assert.deepEqual(issues.find(item => item.slug === original.slug), original);
  const published = issues.find(item => item.number === '11');
  assert.equal(published?.source, 'submission');
  assert.equal(published?.pdfUrl, `${publicBase}/published/${submission().storageKey}`);
  assert.equal(published?.coverUrl, `${publicBase}/published/${submission().storageKey}.cover.jpg`);
});

test('a manifest rebuilt with no submissions is the untouched archive', () => {
  const { issues } = composeManifest(baseCatalog, [], publicBase);
  assert.deepEqual(issues.map(item => item.slug).sort(), baseCatalog.map(item => item.slug).sort());
  for (const slug of ['issue-07-0072', 'issue-08-0073', 'issue-09-0074', 'issue-10-0075'])
    assert.ok(issues.some(item => item.slug === slug), `${slug} must survive a manifest rebuild`);
});

test('a submission replacing an existing issue does not duplicate it', () => {
  const replacement = submission({ id: 'replacement', number: '13', serial: '0078', date: '2000-03-29' });
  const { issues } = composeManifest(baseCatalog, [replacement], publicBase);
  assert.equal(issues.length, baseCatalog.length);
  assert.equal(issues.filter(item => Number(item.number) === 13 && item.year === 2000).length, 1);
  assert.equal(issues.find(item => Number(item.number) === 13)?.source, 'submission');
});

test('issues stay ordered by date and the version advances', () => {
  const { issues, version } = composeManifest(baseCatalog, [submission()], publicBase, 42);
  assert.equal(version, 42);
  assert.deepEqual(issues.map(item => item.date), [...issues.map(item => item.date)].sort());
});
