// Replaces the PDFs on the public site with their redacted public versions.
// Every issue in the live manifest is matched to its cache directory
// (<year>-<NN>-<serial>) and the «(публичная версия).pdf» there is uploaded over
// the same bucket key, so the manifest and the D1 rows stay as they are. The
// cover is re-rendered from the public version when sheet 1 differs from the
// original. Originals must already be copied to the private bucket.
//
//   node scripts/publish-redacted.mjs                  # plan only, uploads nothing
//   node scripts/publish-redacted.mjs --apply          # uploads
//   node scripts/publish-redacted.mjs --apply 2000-27  # only issues whose id starts so
//
// Needs the AWS_* credentials for Selectel (AWS_PROFILE=selectel, AWS_CA_BUNDLE).
// After uploading, purge the cache of the public bucket domain in the Selectel panel.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = args.filter(arg => !arg.startsWith('--'));
const endpoint = process.env.SELECTEL_ENDPOINT ?? 'https://s3.ru-6.storage.selcloud.ru';
const bucket = process.env.SELECTEL_PUBLIC_BUCKET ?? 'pilot-archive-public';
const privateBucket = process.env.SELECTEL_PRIVATE_BUCKET ?? 'pilot-archive-issues-private';
const publicBase = (process.env.SELECTEL_PUBLIC_BASE_URL ?? 'https://pilot-archive.ru').replace(/\/$/, '');
const archiveRoot = process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading');
const cacheRoot = join(archiveRoot, 'pilot-archive-fulltext-cache');
const cacheControl = 'public,max-age=86400';

const aws = (...rest) => execFileSync('aws', ['--endpoint-url', endpoint, ...rest], { encoding: 'utf8' });
const keyOf = url => url.replace(/^https?:\/\/[^/]+/, '').replace(/^\//, '');
const exists = key => { try { aws('s3api', 'head-object', '--bucket', privateBucket, '--key', key); return true; } catch { return false; } };

const response = await fetch(`${publicBase}/archive/manifest.json`, { cache: 'no-store' });
if (!response.ok) throw new Error(`Live manifest unavailable: HTTP ${response.status}`);
const { issues } = await response.json();
const work = mkdtempSync(join(tmpdir(), 'publish-redacted-'));

let problems = 0;
for (const issue of issues) {
  const id = `${issue.year}-${issue.number}-${issue.serial}`;
  if (only.length && !only.some(prefix => id.startsWith(prefix))) continue;
  const dir = join(cacheRoot, id);
  const name = existsSync(dir) && readdirSync(dir).find(file => file.endsWith('(публичная версия).pdf'));
  if (!name) { console.log(`${id}: NO PUBLIC VERSION, skipped`); problems++; continue; }
  const publicPdf = join(dir, name);
  const decisions = join(dir, 'redactions.json');
  if (existsSync(decisions) && statSync(decisions).mtimeMs > statSync(publicPdf).mtimeMs) {
    console.log(`${id}: redactions.json is newer than the public version, run censor --apply first`); problems++; continue;
  }
  const pdfKey = keyOf(issue.pdfUrl);
  const coverKey = keyOf(issue.coverUrl);
  if (!exists(`originals/${pdfKey}`)) { console.log(`${id}: original not backed up at originals/${pdfKey}`); problems++; continue; }

  // Sheet 1 is copied untouched unless something on it was redacted, so a pixel diff finds that.
  const original = join(archiveRoot, 'pilot-archive', name.replace(' (публичная версия)', ''));
  const page1 = (pdf, out) => execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-r', '40', '-singlefile', '-png', pdf, join(work, out)]);
  let coverChanged = true;
  if (existsSync(original)) {
    page1(original, `${id}-a`); page1(publicPdf, `${id}-b`);
    try { execFileSync('magick', ['compare', '-metric', 'AE', join(work, `${id}-a.png`), join(work, `${id}-b.png`), 'null:'], { stdio: 'pipe' }); coverChanged = false; } catch {}
  }
  console.log(`${id}: ${pdfKey}${coverChanged ? ` + cover ${coverKey}` : ''}`);
  if (!apply) continue;

  aws('s3', 'cp', publicPdf, `s3://${bucket}/${pdfKey}`, '--content-type', 'application/pdf', '--cache-control', cacheControl, '--only-show-errors');
  const size = JSON.parse(aws('s3api', 'head-object', '--bucket', bucket, '--key', pdfKey)).ContentLength;
  if (size !== statSync(publicPdf).size) throw new Error(`${id}: uploaded ${size} bytes, expected ${statSync(publicPdf).size}`);
  if (coverChanged) {
    const cover = join(work, `${id}-cover`);
    execFileSync('pdftoppm', ['-f', '1', '-l', '1', '-scale-to-x', '439', '-scale-to-y', '-1', '-singlefile', '-jpeg', '-jpegopt', 'quality=85', publicPdf, cover]);
    aws('s3', 'cp', `${cover}.jpg`, `s3://${bucket}/${coverKey}`, '--content-type', 'image/jpeg', '--cache-control', cacheControl, '--only-show-errors');
  }
}
console.log(problems ? `\n${problems} issue(s) need attention.` : '\nAll issues matched.');
if (!apply) console.log('Nothing uploaded. Re-run with --apply to publish.');
