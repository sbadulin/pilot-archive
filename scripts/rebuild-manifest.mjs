// Rebuilds archive/manifest.json as the migrated archive catalog plus every already
// published submission, with all URLs recomputed into the canonical archive layout.
// Use it to repair a manifest, or after moving objects with archive:migrate.
//
//   npm run manifest:rebuild                    # writes manifest.rebuilt.json, uploads nothing
//   npm run manifest:rebuild -- --apply         # also uploads it to the public bucket
//
// --apply needs SELECTEL_ENDPOINT, SELECTEL_PUBLIC_BUCKET and the AWS_* credentials.
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { composeManifest } from '../functions/api/_lib/manifest.ts';
import { baseCatalog } from '../functions/api/_lib/baseCatalog.ts';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const output = args.find(arg => !arg.startsWith('--')) ?? 'manifest.rebuilt.json';
const endpoint = process.env.SELECTEL_ENDPOINT;
const bucket = process.env.SELECTEL_PUBLIC_BUCKET;
const publicBase = (process.env.SELECTEL_PUBLIC_BASE_URL ?? 'https://pilot-archive.ru').replace(/\/$/, '');
const liveUrl = process.env.PILOT_MANIFEST_URL ?? `${publicBase}/archive/manifest.json`;
if (apply && (!endpoint || !bucket)) throw new Error('Set SELECTEL_ENDPOINT and SELECTEL_PUBLIC_BUCKET');

const catalog = JSON.parse(await readFile('archive-catalog/manifest.json', 'utf8')).issues ?? [];
if (catalog.length !== baseCatalog.length) throw new Error('Run scripts/generate-base-catalog.mjs: the generated base catalog is stale');

const response = await fetch(liveUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Live manifest unavailable: HTTP ${response.status}`);
const live = await response.json();
if (!Array.isArray(live.issues)) throw new Error('Live manifest has no issues array');
const submissions = live.issues.filter(issue => issue.source === 'submission');

const manifest = composeManifest(baseCatalog, submissions, publicBase);
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Live manifest had ${live.issues.length} issues (${submissions.length} from submissions).`);
console.log(`Wrote ${output} with ${manifest.issues.length} issues: ${manifest.issues.map(i => `${i.year}/${i.number}`).join(', ')}`);

if (!apply) {
  console.log('\nNothing uploaded. Re-run with --apply to publish it.');
  process.exit(0);
}
execFileSync('aws', ['--endpoint-url', endpoint, 's3', 'cp', output, `s3://${bucket}/archive/manifest.json`,
  '--content-type', 'application/json', '--cache-control', 'no-cache'], { stdio: 'inherit' });
console.log('Published archive/manifest.json.');
