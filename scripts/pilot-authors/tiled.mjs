// Pilot: recognize pages tile by tile at full scan resolution and merge bylines per page.
// Usage: node tiled.mjs <model> <issue.pdf> <out-dir> <cols>x<rows> <page>...
// Env: PROMPT=pager for pager pages.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const [model, pdf, outDir, grid, ...pages] = process.argv.slice(2);
const [cols, rows] = grid.split('x').map(Number);
const here = new URL('.', import.meta.url).pathname;
const tileRoot = `${process.env.TILE_DIR || tmpdir()}/tiles-${Date.now()}`;

mkdirSync(outDir, { recursive: true });
for (const p of pages) {
  const name = `p-${String(p).padStart(2, '0')}`;
  const tiles = `${tileRoot}/${name}`;
  execFileSync('sh', [`${here}tiles.sh`, pdf, String(p), tiles, String(cols), String(rows), '300'], { stdio: 'ignore' });
  const tileOut = `${outDir}/tiles/${name}`;
  const files = readdirSync(tiles).map((f) => `${tiles}/${f}`);
  execFileSync('node', [`${here}vision.mjs`, model, tileOut, ...files], { stdio: 'inherit', env: process.env });
  const results = readdirSync(tileOut).map((f) => JSON.parse(readFileSync(`${tileOut}/${f}`, 'utf8')));
  // Overlapping tiles can see the same byline twice; keep the first occurrence.
  const seen = new Set();
  const articles = results.flatMap((r) => r.articles ?? []).filter((a) => {
    const key = (a.byline ?? `∅${a.title}`).toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  writeFileSync(`${outDir}/${name}.json`, JSON.stringify({ page: name, model, tiles: files.length, articles }, null, 2));
  console.log(`${name}: ${articles.filter((a) => a.byline).length} bylines from ${files.length} tiles`);
}
