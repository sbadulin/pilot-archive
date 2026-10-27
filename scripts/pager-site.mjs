// Данные раздела «Пейджер» для сайта: pager-site.json в корне кэша (не в репозитории).
//
//   npm run pager:site -- [--cache <dir>] [--authors <url|file>] [--pdfs <dir>]
//
// Берёт pager-public.json (там уже закрыто то, что закрыто в PDF) и убирает сообщения с hold: true
// (решение цензуры не перенесено надёжно), пересказы («[пересказ] …» — не слова читателя) и тексты
// редакции (scripts/pager-exclude.json, колонтитулы). Развороты номеров — по исходным PDF (--pdfs).
// Ники — по тем же правилам, что pager-nicks.json (src/pagerNicks.ts, scripts/pager-nick-aliases.json);
// профиль есть только у уникальных ников. «В газете» — материалы из публичного индекса авторов
// (по умолчанию https://pilot-archive.ru/archive/authors-index.json, только чтение) с тем же ключом.
// Адресаты остаются как напечатаны; на сайте ссылки и поиск только по никам, не по «Имя Фамилия».
// Выкладка на сайт — npm run pager:publish.
import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { dialogsOf, preparePager } from '../src/pagerFeed.ts';
import { buildPagerSite } from '../src/pagerSite.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const cacheRoot = option('cache', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache'));
const authorsSource = option('authors', 'https://pilot-archive.ru/archive/authors-index.json');
const pdfRoot = option('pdfs', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive'));

const rules = JSON.parse(await readFile(new URL('./pager-nick-aliases.json', import.meta.url), 'utf8'));
const messages = JSON.parse(await readFile(join(cacheRoot, 'pager-public.json'), 'utf8'));
const authors = /^https?:/.test(authorsSource)
  ? await (await fetch(authorsSource, { cache: 'no-store' })).json()
  : JSON.parse(await readFile(authorsSource, 'utf8'));

const { exclude } = JSON.parse(await readFile(new URL('./pager-exclude.json', import.meta.url), 'utf8'));

// Sheets scanned as two-page spreads, by the reader's rule (src/app.tsx): area over 1.3× the median.
// Recognition numbers sheets, the reader's links name printed pages, so the site needs both.
const pdfs = await readdir(pdfRoot).catch(() => []);
const spreads = {};
for (const issue of new Set(messages.map((message) => `${message.year}-${message.number}-${message.serial}`))) {
  const serial = issue.split('-')[2];
  const file = pdfs.find((name) => name.endsWith('.pdf') && name.includes(`(${serial})`));
  if (!file) { console.warn(`No PDF for ${issue} in ${pdfRoot}: its links name sheets`); continue; }
  const info = execFileSync('pdfinfo', ['-f', '1', '-l', '9999', join(pdfRoot, file)], { encoding: 'utf8' });
  const areas = [...info.matchAll(/^Page\s+\d+\s+size:\s+([\d.]+)\s+x\s+([\d.]+)/gm)].map((match) => Number(match[1]) * Number(match[2]));
  const typical = [...areas].sort((a, b) => a - b)[Math.floor(areas.length / 2)] ?? 0;
  spreads[issue] = areas.flatMap((area, index) => (area > typical * 1.3 ? [index + 1] : []));
}

const { site, stats } = buildPagerSite(messages, rules, authors, { exclude, spreads });
// Search examples: the nicks with the most two-sided dialogs. One-sided ones are mostly words read
// as nicks («Люблю», «Пока») collecting mentions, so they do not count except to break a tie.
const model = preparePager(site);
site.featured = site.profiles
  // Readers only: the editorial (ПТ, ТТ…) answered everyone.
  .filter((profile) => !profile.staff)
  .map((profile) => {
    const dialogs = dialogsOf(model, profile.key);
    return { name: profile.name, both: dialogs.filter((dialog) => dialog.mine && dialog.theirs).length, all: dialogs.length };
  })
  .sort((a, b) => b.both - a.both || b.all - a.all || a.name.localeCompare(b.name, 'ru'))
  .slice(0, 3)
  .map((row) => row.name);
console.log(`Search examples: ${site.featured.join(', ')}`);
const body = JSON.stringify(site);
const out = join(cacheRoot, 'pager-site.json');
await writeFile(out, body);

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
console.log(`Messages: ${stats.kept} of ${stats.total} kept; dropped ${stats.dropped.hold} on hold, ${stats.dropped.retold} retold, ${stats.dropped.duplicate} recognized twice, ${stats.dropped.editorial} editorial`);
console.log(`Spreads: ${Object.entries(site.spreads ?? {}).map(([issue, sheets]) => `${issue} ${sheets.join(',')}`).join('; ') || 'none'}`);
console.log(`Signed by a profile: ${site.messages.filter((message) => message.nicks).length}`);
console.log(`Profiles: ${stats.profiles}; with «В газете» articles: ${stats.withArticles}`);
// The texts alone are most of the file; the site's Caddy serves JSON gzip-compressed.
const texts = Buffer.byteLength(site.messages.map((message) => message.text).join(''));
console.log(`Wrote ${out}: ${kb(Buffer.byteLength(body))} (texts ${kb(texts)}; gzip ${kb(gzipSync(body).length)})`);
