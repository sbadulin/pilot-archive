// Таблица ников «Пейджера»: кто сколько писал и когда, уникален ли ник, есть ли он среди авторов.
//
//   npm run pager:nicks -- [--cache <dir>] [--authors <url|file>] [--show BAD]
//
// Берёт подписи (from) из pager-public.json — там уже закрыто то, что закрыто в PDF. Ключ ника —
// normalizeName (как у авторов), правила «уникальности» — classifyNick в src/pagerNicks.ts,
// ручные склейки и «разные люди» — scripts/pager-nick-aliases.json. Похожие ники сами не
// склеиваются: они попадают в profileCandidates на ручное подтверждение. Уникальные ники сверяются по ключу с
// публичным индексом авторов (по умолчанию https://pilot-archive.ru/archive/authors-index.json,
// только чтение). Адресатов (to) здесь нет намеренно: их не связываем и не собираем (152-ФЗ).
// Пишет pager-nicks.json в корень кэша; --show <ник> печатает его сообщения и упоминания.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { normalizeName } from '../src/authorNames.ts';
import { buildNicks, nickKey, profileCandidates } from '../src/pagerNicks.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const cacheRoot = option('cache', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache'));
const authorsSource = option('authors', 'https://pilot-archive.ru/archive/authors-index.json');
const show = option('show', null);

const rules = JSON.parse(await readFile(new URL('./pager-nick-aliases.json', import.meta.url), 'utf8'));
const messages = JSON.parse(await readFile(join(cacheRoot, 'pager-public.json'), 'utf8'));
const nicks = buildNicks(messages, rules);
// Кандидаты в один профиль: ничего не склеиваем, только предлагаем (решение — в pager-nick-aliases.json).
const candidates = profileCandidates(nicks, rules);

const authors = /^https?:/.test(authorsSource)
  ? await (await fetch(authorsSource)).json()
  : JSON.parse(await readFile(authorsSource, 'utf8'));
const authorsByKey = new Map();
for (const entry of authors.names) for (const key of entry.keys ?? [entry.key]) authorsByKey.set(key, entry);
const authorMatches = nicks
  .filter(nick => nick.unique && authorsByKey.has(nick.key))
  .map(nick => {
    const author = authorsByKey.get(nick.key);
    return { key: nick.key, nick: nick.name, messages: nick.messages, author: author.name, credits: author.credits };
  });

const classes = {};
for (const nick of nicks) classes[nick.class] = (classes[nick.class] ?? 0) + 1;
const unique = nicks.filter(nick => nick.unique);
const summary = {
  messages: messages.length,
  signed: messages.filter(message => message.from?.trim()).length,
  nicks: nicks.length,
  classes,
  uniqueMessages: unique.reduce((sum, nick) => sum + nick.messages, 0),
  top: unique.slice(0, 30).map(nick => ({ name: nick.name, messages: nick.messages, first: nick.first, last: nick.last })),
  authorMatches: authorMatches.length,
  profileCandidates: candidates.length,
};
await writeFile(join(cacheRoot, 'pager-nicks.json'), JSON.stringify({ generated: new Date().toISOString(), summary, nicks, profileCandidates: candidates, authorMatches }, null, 2));

console.log(`Pager nicks: ${nicks.length} nicks from ${summary.signed} signed messages; ${JSON.stringify(classes)}`);
console.log(`Unique nicks: ${unique.length} (${summary.uniqueMessages} messages). Top 30:`);
for (const nick of summary.top) console.log(`  ${String(nick.messages).padStart(4)}  ${nick.name}  (${nick.first} — ${nick.last})`);
console.log(`Unique nicks that are also author credits: ${authorMatches.length}`);
for (const match of authorMatches) console.log(`  ${match.nick} (${match.messages} msg) ↔ ${match.author}: ${match.credits.map(credit => `${credit.issue}/${credit.page}`).join(', ')}`);

console.log(`Profile candidates (manual check): ${candidates.length}; first 15:`);
for (const candidate of candidates.slice(0, 15)) console.log(`  ${candidate.names.join(' / ')} (${candidate.messages} msg; ${candidate.reasons.join(', ')})`);

if (show) {
  const key = nickKey(show, rules);
  const nick = nicks.find(entry => entry.key === key);
  const excerpt = text => (text.length > 160 ? `${text.slice(0, 160)}…` : text).replace(/\s+/g, ' ');
  console.log(`\n«${show}» (key ${key}): ${nick ? `${nick.messages} signed, class ${nick.class}, spellings ${nick.spellings.join(' | ')}` : 'no signed messages'}`);
  for (const id of nick?.ids ?? []) {
    const message = messages.find(entry => entry.id === id);
    console.log(`  signed ${id} ${message.date} [${message.from}]: ${excerpt(message.text)}`);
  }
  // Упоминания: ник отдельным словом в тексте или среди адресатов; регистр важен
  // («BAD», но не «bad» в «Bad Girl» — там следующее слово делает другой ник).
  const word = new RegExp(`(?<![\\p{L}\\p{N}])(?:${show.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![\\p{L}\\p{N}]|\\s+(?:Girl|Boy|Cirh)\\b)`, 'u');
  for (const message of messages) {
    if (nick?.ids.includes(message.id)) continue;
    if (word.test(message.text) || message.to.some(name => word.test(name))) {
      console.log(`  mention ${message.id} ${message.date} [from ${message.from ?? '—'}]: ${excerpt(message.text)}`);
    }
  }
  const author = authorsByKey.get(key) ?? authors.names.find(entry => normalizeName(entry.name) === key);
  console.log(`  authors index: ${author ? `${author.name}: ${author.credits.map(credit => `${credit.issue}/${credit.page} ${credit.kind} «${credit.title}»`).join('; ')}` : 'none'}`);
}
