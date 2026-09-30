// Recognize bylines in original issue scans; results are cached per sheet, so reruns resume.
// Usage: node --experimental-strip-types scripts/authors/recognize-archive.mjs <originals-dir> [--cache=<dir>] [--only=<filename part>]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseFilename } from '../../src/metadata.ts';
import { printedPages } from '../../src/readerLayout.ts';
import { recognizeSheet } from './ai.mjs';

const [dir, ...flags] = process.argv.slice(2);
const flag = (name) => flags.find((f) => f.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
const cacheDir = flag('cache') ?? '.authors-cache';
const only = flag('only');
const PARALLEL = 3;
if (!dir) throw new Error('Usage: recognize-archive.mjs <originals-dir> [--cache=<dir>] [--only=<filename part>]');

// Same rule as the reader: a sheet 1.3× larger than the median one is a two-page spread.
function sheetLayout(pdf) {
  const info = execFileSync('pdfinfo', ['-f', '1', '-l', '999', pdf], { encoding: 'utf8' });
  const areas = [...info.matchAll(/^Page\s+\d+ size:\s+([\d.]+) x ([\d.]+)/gm)].map((m) => Number(m[1]) * Number(m[2]));
  const typical = [...areas].sort((a, b) => a - b)[Math.floor(areas.length / 2)];
  const large = areas.flatMap((area, i) => (area > typical * 1.3 ? [i + 1] : []));
  return { count: areas.length, printed: printedPages(areas.length, large) };
}

function renderSheet(pdf, sheet) {
  const prefix = join(tmpdir(), `authors-${process.pid}-${sheet}`);
  execFileSync('pdftoppm', ['-f', String(sheet), '-l', String(sheet), '-r', '150', '-jpeg', '-jpegopt', 'quality=85', '-singlefile', pdf, prefix]);
  const jpeg = readFileSync(`${prefix}.jpg`);
  rmSync(`${prefix}.jpg`);
  return jpeg;
}

async function processIssue(pdf) {
  const meta = parseFilename(basename(pdf));
  if (!meta.number || !meta.date) { console.log(`skip ${basename(pdf)}: cannot read number/date from the filename`); return; }
  const year = Number(meta.date.slice(0, 4));
  const issue = { year, number: meta.number.padStart(2, '0'), serial: meta.serial, date: meta.date };
  const issueDir = join(cacheDir, `${year}-${issue.number}-${issue.serial}`);
  mkdirSync(issueDir, { recursive: true });
  const { count, printed } = sheetLayout(pdf);

  const sheets = Array.from({ length: count }, (_, i) => i + 1).filter((s) => !existsSync(join(issueDir, `sheet-${String(s).padStart(2, '0')}.json`)));
  const queue = [...sheets];
  const worker = async () => {
    for (let sheet = queue.shift(); sheet; sheet = queue.shift()) {
      const file = join(issueDir, `sheet-${String(sheet).padStart(2, '0')}.json`);
      try {
        const out = await recognizeSheet(renderSheet(pdf, sheet));
        writeFileSync(file, JSON.stringify({ ...issue, sheet, printedPage: printed.first(sheet), ...out }, null, 2));
        const r = out.result;
        console.log(`  ${basename(issueDir)} sheet ${sheet}: ${r.pageType ?? '?'}, ${(r.articles ?? []).filter((a) => a.byline).length} signed${out.fallbackReason ? ` (Sonnet: ${out.fallbackReason})` : ''}`);
      } catch (e) {
        // Not cached: the next run retries this sheet.
        console.log(`  ${basename(issueDir)} sheet ${sheet}: FAILED ${e.message}`);
      }
    }
  };
  console.log(`${basename(pdf)} → ${basename(issueDir)}: ${count} sheets, ${sheets.length} to recognize`);
  await Promise.all(Array.from({ length: PARALLEL }, worker));

  // The cover is a free check that the filename metadata matches the scan.
  const cover = join(issueDir, 'sheet-01.json');
  if (existsSync(cover)) {
    const c = JSON.parse(readFileSync(cover, 'utf8')).result.cover;
    if (c && (Number(c.number) !== Number(issue.number) || (issue.serial && Number(c.serial) !== Number(issue.serial)) || c.date !== issue.date))
      console.log(`  WARNING cover says ${JSON.stringify(c)}, filename says ${JSON.stringify(issue)}`);
  }
}

const pdfs = readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.pdf') && (!only || f.includes(only))).sort().map((f) => join(dir, f));
for (const pdf of pdfs) await processIssue(pdf);
