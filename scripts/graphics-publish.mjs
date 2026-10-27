// Publishes the artists' drawings for the author card: graphics-site.json from the cache root
// (npm run graphics:site) goes to archive/graphics.json, its thumbnails to archive/graphics/<id>.jpg.
//
//   npm run graphics:publish                 # plan only, uploads nothing
//   npm run graphics:publish -- --apply      # uploads new and changed thumbnails, then the list
//   npm run graphics:publish -- --cache <dir>
//
// Uploads through the Russian relay (scripts/relay-upload.mjs). Thumbnails go first, so the list never
// points at a missing picture; one already published with the same size is skipped.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { bucket, listPublic, publicBase, relayUpload } from './relay-upload.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const cacheRoot = option('cache', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache'));

const file = join(cacheRoot, 'graphics-site.json');
const site = JSON.parse(readFileSync(file, 'utf8'));
if (site.version !== 1 || !Array.isArray(site.artists)) throw new Error(`${file} is not a graphics-site.json (run npm run graphics:site)`);
const drawings = site.artists.flatMap((artist) => artist.drawings);
const thumbs = drawings.map((drawing) => ({ file: join(cacheRoot, 'graphics', 'thumbs', `${drawing.id}.jpg`), key: `archive/graphics/${drawing.id}.jpg` }));
const missing = thumbs.filter((thumb) => !existsSync(thumb.file));
if (missing.length) throw new Error(`No thumbnail for ${missing.map((thumb) => thumb.key).join(', ')}; run npm run graphics:site`);

for (const artist of site.artists) console.log(`${artist.name}: ${artist.drawings.length} drawings`);
console.log(`→ s3://${bucket}/archive/graphics.json + ${thumbs.length} thumbnails = ${publicBase}/archive/graphics.json`);
if (!apply) {
  console.log('Nothing uploaded. Re-run with --apply to publish.');
  process.exit(0);
}
const published = listPublic('archive/graphics/');
let sent = 0;
for (const thumb of thumbs) {
  if (published.get(thumb.key) === statSync(thumb.file).size) continue;
  relayUpload(thumb.file, thumb.key, 'image/jpeg', 'public, max-age=86400');
  sent++;
}
relayUpload(file, 'archive/graphics.json', 'application/json', 'no-cache');
console.log(`Published ${publicBase}/archive/graphics.json; thumbnails: ${sent} uploaded, ${thumbs.length - sent} already there`);
