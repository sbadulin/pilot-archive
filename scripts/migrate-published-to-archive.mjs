// One-time move of already approved submissions from published/submissions/<year>/<slug>/<id>.pdf
// into the archive tree the migrated originals live in: archive/<year>/<slug>/issue-<id>.pdf.
//
//   export SELECTEL_ENDPOINT=https://s3.ru-6.storage.selcloud.ru
//   export SELECTEL_PUBLIC_BUCKET=pilot-archive-public
//   export AWS_PROFILE=selectel AWS_DEFAULT_REGION=ru-6
//   export AWS_CA_BUNDLE=/usr/local/etc/ca-certificates/cert.pem   # aws-cli 2.2.7 ships a stale one
//
//   npm run archive:migrate                # prints the plan, touches nothing
//   npm run archive:migrate -- --apply     # copies objects to the new keys
//   npm run manifest:rebuild -- --apply    # publishes the manifest pointing at them
//   npm run archive:migrate -- --cleanup   # only then removes the old keys
//
// Copy before cleanup, never move: both locations stay readable while the manifest catches up,
// so no issue is unreachable at any point.
import { execFileSync } from 'node:child_process';
import { archiveCoverKey, archiveKey } from '../functions/api/_lib/validation.ts';

const apply = process.argv.includes('--apply');
const cleanup = process.argv.includes('--cleanup');
const endpoint = process.env.SELECTEL_ENDPOINT;
const bucket = process.env.SELECTEL_PUBLIC_BUCKET;
const liveUrl = process.env.PILOT_MANIFEST_URL ?? 'https://pilot-archive.ru/archive/manifest.json';
if ((apply || cleanup) && (!endpoint || !bucket)) throw new Error('Set SELECTEL_ENDPOINT and SELECTEL_PUBLIC_BUCKET');
if (apply && cleanup) throw new Error('Run --apply first, publish the manifest, then --cleanup');

const aws = (...args) => execFileSync('aws', ['--endpoint-url', endpoint, 's3', ...args], { stdio: 'inherit' });
const exists = async url => (await fetch(url, { method: 'HEAD' })).ok;

// Cleanup runs after the manifest already points at the new keys, so it cannot read the
// old ones from the manifest — it reads them from the bucket instead.
function staleObjects() {
  const out = execFileSync('aws', ['--endpoint-url', endpoint, 's3api', 'list-objects-v2',
    '--bucket', bucket, '--prefix', 'published/', '--output', 'json'], { encoding: 'utf8' });
  const keys = (JSON.parse(out || '{}').Contents ?? []).map(item => item.Key);
  return keys.map(key => {
    const match = key.match(/^published\/submissions\/(\d{4})\/(issue-\d{2}-\d{4})\/([0-9a-fA-F-]+)\.pdf(\.cover\.jpg)?$/);
    if (!match) throw new Error(`Unexpected object under published/: ${key}`);
    const [, year, slug, id, cover] = match;
    return { from: key, to: `archive/${year}/${slug}/${cover ? `cover-${id}.jpg` : `issue-${id}.pdf`}` };
  });
}

const site = (process.env.SELECTEL_PUBLIC_BASE_URL ?? 'https://pilot-archive.ru').replace(/\/$/, '');

if (cleanup) {
  const stale = staleObjects();
  if (stale.length === 0) {
    console.log('Nothing to clean up: the published/ tree is already empty.');
    process.exit(0);
  }
  for (const object of stale) {
    if (!(await exists(`${site}/${object.to}`))) throw new Error(`Refusing to delete ${object.from}: ${object.to} is not readable yet`);
  }
  for (const object of stale) aws('rm', `s3://${bucket}/${object.from}`);
  console.log(`\nRemoved ${stale.length} objects from the old published/ tree.`);
  process.exit(0);
}

const response = await fetch(liveUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Live manifest unavailable: HTTP ${response.status}`);
const live = await response.json();
if (!Array.isArray(live.issues)) throw new Error('Live manifest has no issues array');

const keyOf = url => new URL(url, site).pathname.replace(/^\//, '');
const moves = [];
for (const issue of live.issues.filter(item => item.source === 'submission')) {
  const pdf = { from: keyOf(issue.pdfUrl), to: archiveKey(issue.year, issue.number, issue.serial, issue.id) };
  const cover = { from: keyOf(issue.coverUrl), to: archiveCoverKey(issue.year, issue.number, issue.serial, issue.id) };
  for (const move of [pdf, cover]) if (move.from !== move.to) moves.push(move);
}

if (moves.length === 0) {
  console.log('Nothing to do: every published issue already sits in the archive tree.');
  process.exit(0);
}

for (const move of moves) console.log(`${move.from}\n  -> ${move.to}`);
if (!apply) {
  console.log(`\n${moves.length} objects would be copied. Re-run with --apply to perform the copy.`);
  process.exit(0);
}
for (const move of moves) {
  aws('cp', `s3://${bucket}/${move.from}`, `s3://${bucket}/${move.to}`);
}
console.log(`\nCopied ${moves.length} objects. Next: npm run manifest:rebuild -- --apply`);
