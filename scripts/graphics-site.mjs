// Рисунки художников для карточки автора: graphics-site.json и превью в graphics/thumbs/ в корне кэша
// (не в репозитории). Выкладка — npm run graphics:publish.
//
//   npm run graphics:site -- [--cache <dir>] [--force]
//
// Берёт разметку графики (graphics/<номер>.json, её делают агенты по сканам page-NN.jpg) и правила
// scripts/graphics-artists.json: чей рисунок, ручные решения, подписи. Превью режутся из публичной
// версии PDF (там закрыто то, что закрыто цензурой), отрендеренной ровно в размер скана разметки,
// поэтому рамка разметки ложится на неё без пересчёта. Готовые превью не перерисовываются без --force.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildGraphicsSite } from '../src/artistGraphics.ts';
import { spreadSheets } from './spreads.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const cacheRoot = option('cache', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache'));
const force = args.includes('--force');
const rules = JSON.parse(readFileSync(new URL('./graphics-artists.json', import.meta.url), 'utf8'));
const catalogDir = join(cacheRoot, 'graphics');
const thumbDir = join(catalogDir, 'thumbs');

const sizes = new Map();
const pageSize = (issue, sheet) => {
  const key = `${issue}/${sheet}`;
  if (!sizes.has(key)) {
    const file = join(cacheRoot, issue, `page-${String(sheet).padStart(2, '0')}.jpg`);
    sizes.set(key, execFileSync('magick', ['identify', '-format', '%w %h', file], { encoding: 'utf8' }).trim().split(' ').map(Number));
  }
  return sizes.get(key);
};
const publicPdf = (issue) => {
  const name = readdirSync(join(cacheRoot, issue)).find((file) => file.endsWith('(публичная версия).pdf'));
  if (!name) throw new Error(`No public PDF for ${issue}: drawings must not be cut from the original`);
  return join(cacheRoot, issue, name);
};

const issues = readdirSync(catalogDir)
  .filter((file) => /^\d{4}-\d{2}-\d{4}\.json$/.test(file))
  .sort()
  .map((file) => {
    const issue = file.replace(/\.json$/, '');
    const sheets = readdirSync(join(cacheRoot, issue)).filter((name) => /^page-\d+\.jpg$/.test(name)).length;
    return { issue, sheets, graphics: JSON.parse(readFileSync(join(catalogDir, file), 'utf8')), spreads: spreadSheets(publicPdf(issue)), size: (sheet) => pageSize(issue, sheet) };
  });
const site = buildGraphicsSite(issues, rules);

mkdirSync(thumbDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'graphics-'));
let drawn = 0;
for (const drawing of site.artists.flatMap((artist) => artist.drawings)) {
  const out = join(thumbDir, `${drawing.id}.jpg`);
  if (existsSync(out) && !force) continue;
  const [width, height] = pageSize(drawing.issue, drawing.sheet);
  const prefix = join(work, drawing.id);
  execFileSync('pdftoppm', ['-f', String(drawing.sheet), '-l', String(drawing.sheet), '-scale-to-x', String(width), '-scale-to-y', String(height),
    '-jpeg', '-singlefile', publicPdf(drawing.issue), prefix]);
  const [x0, y0, x1, y1] = drawing.box;
  const crop = `${Math.round((x1 - x0) * width)}x${Math.round((y1 - y0) * height)}+${Math.round(x0 * width)}+${Math.round(y0 * height)}`;
  execFileSync('magick', [`${prefix}.jpg`, '-crop', crop, '+repage', '-resize', '960x960>', '-strip', '-interlace', 'Plane', '-quality', '82', out]);
  drawn++;
}
rmSync(work, { recursive: true, force: true });

const out = join(cacheRoot, 'graphics-site.json');
writeFileSync(out, JSON.stringify(site));
for (const artist of site.artists) console.log(`${artist.name}: ${artist.drawings.length} drawings`);
console.log(`Thumbnails: ${drawn} drawn, in ${thumbDir}`);
console.log(`Wrote ${out}`);
