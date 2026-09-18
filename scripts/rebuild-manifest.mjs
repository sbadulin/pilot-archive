// Rebuilds archive/manifest.json as the migrated archive plus every already published
// submission, and writes it to the path given as the first argument (default manifest.rebuilt.json).
//
//   node scripts/rebuild-manifest.mjs [output] [--live https://pilot-archive.ru/archive/manifest.json]
//
// Upload the result with:
//   aws --endpoint-url "$SELECTEL_ENDPOINT" s3 cp <output> "s3://$SELECTEL_PUBLIC_BUCKET/archive/manifest.json" \
//     --content-type application/json --cache-control no-cache
import { readFile, writeFile } from 'node:fs/promises';

const args = process.argv.slice(2);
const liveFlag = args.indexOf('--live');
const liveUrl = liveFlag === -1 ? 'https://pilot-archive.ru/archive/manifest.json' : args[liveFlag + 1];
const output = args.find(arg => !arg.startsWith('--') && arg !== liveUrl) ?? 'manifest.rebuilt.json';

const base = (JSON.parse(await readFile('archive-catalog/manifest.json', 'utf8')).issues ?? []);
if (base.length === 0) throw new Error('Archive catalog is empty');

const response = await fetch(liveUrl, { cache: 'no-store' });
if (!response.ok) throw new Error(`Live manifest unavailable: HTTP ${response.status}`);
const live = await response.json();
const published = (live.issues ?? []).filter(issue => issue.source === 'submission');
if (!Array.isArray(live.issues)) throw new Error('Live manifest has no issues array');

const identity = issue => `${Number(issue.year)}/${Number(issue.number)}/${Number(issue.serial)}`;
const merged = new Map(base.map(issue => [identity(issue), issue]));
for (const issue of published) merged.set(identity(issue), issue);
const issues = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date) || Number(a.number) - Number(b.number));

await writeFile(output, `${JSON.stringify({ version: Date.now(), issues }, null, 2)}\n`);
console.log(`Live manifest had ${live.issues.length} issues (${published.length} from submissions).`);
console.log(`Wrote ${output} with ${issues.length} issues: ${issues.map(i => `${i.year}/${i.number}`).join(', ')}`);
