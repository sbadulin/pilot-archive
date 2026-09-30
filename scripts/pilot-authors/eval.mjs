// Compare model bylines with a reference, page by page.
// Usage: node eval.mjs <ref.json> <model-out-dir> [--skip-kinds=pager,ads,other] [--verbose]
import { readFileSync, existsSync } from 'node:fs';

const [refPath, outDir, ...flags] = process.argv.slice(2);
const verbose = flags.includes('--verbose');
const skipKinds = new Set((flags.find((f) => f.startsWith('--skip-kinds='))?.split('=')[1] ?? 'pager,ads,other').split(','));
const ref = JSON.parse(readFileSync(refPath, 'utf8'));

const norm = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/\*\*/g, '').replace(/[«»"'.,:;!?()\-–—&]/g, ' ').replace(/\s+/g, ' ').trim();
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// exact: same after normalization; close: small typo distance or one contains the other.
function match(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return null;
  if (x === y) return 'exact';
  if (1 - lev(x, y) / Math.max(x.length, y.length) >= 0.8) return 'close';
  if (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x))) return 'close';
  return null;
}

const t = { ref: 0, exact: 0, close: 0, missed: 0, extra: 0 };
const misses = [], extras = [], closes = [];
for (const page of ref.pages) {
  const want = page.materials.filter((m) => m.byline && !skipKinds.has(m.kind)).map((m) => m.byline);
  if (page.materials.some((m) => skipKinds.has(m.kind) && m.kind === 'pager')) continue; // pager pages are a separate run
  const file = `${outDir}/${page.page}.json`;
  const got = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')).articles ?? []).map((a) => a.byline).filter(Boolean) : [];
  const used = new Set();
  t.ref += want.length;
  for (const w of want) {
    let best = null, bi = -1;
    got.forEach((g, i) => { if (used.has(i)) return; const m = match(w, g); if (m && (best !== 'exact')) { best = m; bi = i; } });
    if (best) { used.add(bi); t[best]++; if (best === 'close') closes.push(`${page.page}: «${w}» ≈ «${got[bi]}»`); }
    else { t.missed++; misses.push(`${page.page}: «${w}»`); }
  }
  got.forEach((g, i) => { if (!used.has(i)) { t.extra++; extras.push(`${page.page}: «${g}»`); } });
}

const found = t.exact + t.close;
console.log(`${ref.issue}: reference bylines ${t.ref}, found ${found} (${Math.round((100 * found) / (t.ref || 1))}%: exact ${t.exact}, close ${t.close}), missed ${t.missed}, extra ${t.extra}`);
if (ref.cover) {
  const c = existsSync(`${outDir}/p-01.json`) ? JSON.parse(readFileSync(`${outDir}/p-01.json`, 'utf8')).cover : null;
  const ok = c && Number(c.number) === Number(ref.cover.number) && Number(c.serial) === Number(ref.cover.serial) && c.date === ref.cover.date;
  console.log(`cover: ${ok ? 'OK' : 'MISMATCH'} ${JSON.stringify(c)} vs ${JSON.stringify(ref.cover)}`);
}
if (verbose) {
  console.log('\nclose:'); closes.forEach((s) => console.log('  ' + s));
  console.log('missed:'); misses.forEach((s) => console.log('  ' + s));
  console.log('extra:'); extras.forEach((s) => console.log('  ' + s));
}
