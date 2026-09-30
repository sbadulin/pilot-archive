// Turn the recognition cache into SQL for D1 (credits + recognition_runs).
// Usage: node --experimental-strip-types scripts/authors/to-sql.mjs [--cache=<dir>] > authors.sql
// Apply: wrangler d1 execute pilot_archive --remote --file=authors.sql
// Re-importing an issue replaces its automatic credits; curator-confirmed or hidden ones stay.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { creditsFromSheet } from '../../src/authorNames.ts';

const cacheDir = process.argv.find((a) => a.startsWith('--cache='))?.split('=')[1] ?? '.authors-cache';
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const now = new Date().toISOString();
const fixes = JSON.parse(readFileSync('archive-catalog/name-fixes.json', 'utf8'));
const out = [];
let total = 0;

for (const issueDir of readdirSync(cacheDir).sort()) {
  const sheets = readdirSync(join(cacheDir, issueDir)).filter((f) => f.startsWith('sheet-')).sort()
    .map((f) => JSON.parse(readFileSync(join(cacheDir, issueDir, f), 'utf8')));
  if (!sheets.length) continue;
  const { year, number, serial } = sheets[0];
  const where = `issue_year = ${year} AND issue_number = ${q(number)} AND issue_serial = ${q(serial)}`;
  out.push(`DELETE FROM credits WHERE ${where} AND status = 'auto';`);
  for (const s of sheets) {
    out.push(`INSERT OR REPLACE INTO recognition_runs (issue_year, issue_number, issue_serial, sheet, model, status, raw_json, created_at) VALUES (${[year, number, serial, s.sheet, s.model, 'ok', JSON.stringify(s.result), now].map(q).join(', ')});`);
    const credits = creditsFromSheet(s.result, { year, number, serial, sheet: s.sheet, printedPage: s.printedPage, source: s.model }, fixes);
    for (const c of credits) {
      total++;
      out.push(`INSERT INTO credits (id, issue_year, issue_number, issue_serial, sheet, printed_page, kind, title, byline, name, name_key, source, status, created_at, updated_at) VALUES (${[randomUUID(), c.year, c.number, c.serial, c.sheet, c.printedPage, c.kind, c.title, c.byline, c.name, c.nameKey, c.source, 'auto', now, now].map(q).join(', ')});`);
    }
  }
}
console.log(out.join('\n'));
console.error(`${total} credits`);
