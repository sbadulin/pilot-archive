// Publishes the «Пейджер» section data: pager-site.json from the cache root (npm run pager:site)
// goes to the public bucket as archive/pager.json, next to manifest.json and authors-index.json.
//
//   npm run pager:publish                 # plan only, uploads nothing
//   npm run pager:publish -- --apply      # uploads
//   npm run pager:publish -- --cache <dir>
//
// Uploads through the Russian relay (scripts/relay-upload.mjs) with Cache-Control: no-cache, so the
// site re-checks it on every visit, like the authors index.
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bucket, publicBase, relayUpload } from './relay-upload.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const cacheRoot = option('cache', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache'));
const key = 'archive/pager.json';
const type = 'application/json';
const cacheControl = 'no-cache';

const file = join(cacheRoot, 'pager-site.json');
const site = JSON.parse(readFileSync(file, 'utf8'));
if (site.version !== 1 || !Array.isArray(site.messages) || !Array.isArray(site.profiles) || !site.dates) {
  throw new Error(`${file} is not a pager-site.json (run npm run pager:site)`);
}
// Fail closed: held and retold messages must never reach the site, whatever produced the file.
if (site.messages.some((message) => message.hold || /^\s*\[пересказ\]/iu.test(message.text))) {
  throw new Error(`${file} contains held or retold messages; rebuild it with npm run pager:site`);
}
const size = statSync(file).size;
console.log(`${file}: ${site.messages.length} messages, ${site.profiles.length} profiles, ${(size / 1024).toFixed(0)} KB`);
console.log(`→ s3://${bucket}/${key} (${type}, Cache-Control: ${cacheControl}) = ${publicBase}/${key}`);
if (!apply) {
  console.log('Nothing uploaded. Re-run with --apply to publish.');
  process.exit(0);
}
relayUpload(file, key, type, cacheControl);
console.log(`Published ${publicBase}/${key}`);
