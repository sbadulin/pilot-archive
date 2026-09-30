// Turn the recognition cache into SQL for D1 (credits + recognition_runs).
// Usage: node --experimental-strip-types scripts/authors/to-sql.mjs [--cache=<dir>] > authors.sql
// Apply: wrangler d1 execute pilot_archive --remote --file=authors.sql
// Credit ids are derived from where the name was found, so re-importing an issue keeps
// curator renames and hidden credits; name_fixes is applied to whatever is new.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { creditsFromSheet } from '../../src/authorNames.ts';

const cacheDir = process.argv.find((a) => a.startsWith('--cache='))?.split('=')[1] ?? '.authors-cache';
const q = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const now = new Date().toISOString();
const out = [];
let total = 0;

for (const issueDir of readdirSync(cacheDir).filter((d) => /^\d{4}-/.test(d)).sort()) {
  const sheets = readdirSync(join(cacheDir, issueDir)).filter((f) => f.startsWith('sheet-')).sort()
    .map((f) => JSON.parse(readFileSync(join(cacheDir, issueDir, f), 'utf8')));
  for (const s of sheets) {
    out.push(`INSERT OR REPLACE INTO recognition_runs (issue_year, issue_number, issue_serial, sheet, model, status, raw_json, created_at) VALUES (${[s.year, s.number, s.serial, s.sheet, s.model, 'ok', JSON.stringify(s.result), now].map(q).join(', ')});`);
    const credits = creditsFromSheet(s.result, { year: s.year, number: s.number, serial: s.serial, sheet: s.sheet, printedPage: s.printedPage, source: s.model });
    for (const c of credits) {
      total++;
      const id = createHash('sha1').update([c.year, c.number, c.serial, c.sheet, c.title, c.byline, c.name].join('\u0000')).digest('hex');
      out.push(`INSERT INTO credits (id, issue_year, issue_number, issue_serial, sheet, printed_page, kind, title, byline, name, name_key, source, status, created_at, updated_at) VALUES (${[id, c.year, c.number, c.serial, c.sheet, c.printedPage, c.kind, c.title, c.byline, c.name, c.nameKey, c.source, 'auto', now, now].map(q).join(', ')}) ON CONFLICT(id) DO NOTHING;`);
    }
  }
}
out.push(`UPDATE credits SET name = f."right", name_key = f.right_key, updated_at = ${q(now)} FROM name_fixes f WHERE credits.name = f.wrong;`);
console.log(out.join('\n'));
console.error(`${total} credits`);
