// Build the public search index straight from the recognition cache (local preview and pre-publish check).
// Usage: node --experimental-strip-types scripts/authors/build-index.mjs [--cache=<dir>] [--out=archive-catalog/authors-index.json]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { creditsFromSheet } from '../../src/authorNames.ts';
import { composeAuthorsIndex } from '../../functions/api/_lib/authorsIndex.ts';

const arg = (name, fallback) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
const cacheDir = arg('cache', '.authors-cache');
const out = arg('out', 'archive-catalog/authors-index.json');

const fixes = JSON.parse(readFileSync('archive-catalog/name-fixes.json', 'utf8'));
const rows = readdirSync(cacheDir).sort().flatMap((issueDir) =>
  readdirSync(join(cacheDir, issueDir)).filter((f) => f.startsWith('sheet-')).flatMap((f) => {
    const s = JSON.parse(readFileSync(join(cacheDir, issueDir, f), 'utf8'));
    return creditsFromSheet(s.result, { year: s.year, number: s.number, serial: s.serial, sheet: s.sheet, printedPage: s.printedPage, source: s.model }, fixes)
      .map((c) => ({ year: c.year, number: c.number, serial: c.serial, page: c.printedPage, kind: c.kind, title: c.title, name: c.name, nameKey: c.nameKey }));
  }));
const index = composeAuthorsIndex(rows);
writeFileSync(out, JSON.stringify(index));
console.log(`${rows.length} credits → ${index.names.length} names → ${out}`);
