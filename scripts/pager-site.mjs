// Данные раздела «Пейджер» для сайта: pager-site.json в корне кэша (не в репозитории).
//
//   npm run pager:site -- [--cache <dir>] [--authors <url|file>]
//
// Берёт pager-public.json (там уже закрыто то, что закрыто в PDF) и убирает сообщения с hold: true
// (решение цензуры не перенесено надёжно) и пересказы («[пересказ] …» — не слова читателя).
// Ники — по тем же правилам, что pager-nicks.json (src/pagerNicks.ts, scripts/pager-nick-aliases.json);
// профиль есть только у уникальных ников. «В газете» — материалы из публичного индекса авторов
// (по умолчанию https://pilot-archive.ru/archive/authors-index.json, только чтение) с тем же ключом.
// Адресаты остаются как напечатаны; на сайте ссылки и поиск только по никам, не по «Имя Фамилия».
// Выкладка на сайт — npm run pager:publish.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { buildPagerSite } from '../src/pagerSite.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const cacheRoot = option('cache', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache'));
const authorsSource = option('authors', 'https://pilot-archive.ru/archive/authors-index.json');

const rules = JSON.parse(await readFile(new URL('./pager-nick-aliases.json', import.meta.url), 'utf8'));
const messages = JSON.parse(await readFile(join(cacheRoot, 'pager-public.json'), 'utf8'));
const authors = /^https?:/.test(authorsSource)
  ? await (await fetch(authorsSource, { cache: 'no-store' })).json()
  : JSON.parse(await readFile(authorsSource, 'utf8'));

const { site, stats } = buildPagerSite(messages, rules, authors);
const body = JSON.stringify(site);
const out = join(cacheRoot, 'pager-site.json');
await writeFile(out, body);

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
console.log(`Messages: ${stats.kept} of ${stats.total} kept; dropped ${stats.dropped.hold} on hold, ${stats.dropped.retold} retold`);
console.log(`Signed by a profile: ${site.messages.filter((message) => message.nicks).length}`);
console.log(`Profiles: ${stats.profiles}; with «В газете» articles: ${stats.withArticles}`);
// The texts alone are most of the file; the site's Caddy serves JSON gzip-compressed.
const texts = Buffer.byteLength(site.messages.map((message) => message.text).join(''));
console.log(`Wrote ${out}: ${kb(Buffer.byteLength(body))} (texts ${kb(texts)}; gzip ${kb(gzipSync(body).length)})`);
