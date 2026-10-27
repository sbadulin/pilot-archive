// Индекс рубрики «Пейджер»: у каждого сообщения — кому оно адресовано и кто подписал.
//
//   npm run pager:index -- [--jobs 2] [--cache <dir>] [--dry-run]
//
// Берёт полнотекстовый кэш (ocr-issue.mjs): Claude уже разбил пейджер на отдельные сообщения,
// подпись обычно лежит в byline. Колонки, которые Claude отдал одним куском (абзацы с «■», «●»,
// номерами), режутся на сообщения здесь же (splitArticles в src/pager.ts). Адресатов размечает
// `claude -p` (подписка Claude Code) — кусками по 60 сообщений, только текст, без картинок.
// Готовая разметка полосы хранится в pager-NN.json рядом с кэшем выпуска и не пересчитывается:
// после добавления выпуска запросы идут только по его новым полосам. Итог — pager-index.json
// в корне кэша (поля — docs/PAGEER.md). Публичный текст с закрытыми местами делает
// pager-public.mjs; сам индекс никуда не выкладывать.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { isGlued, messageId, splitArticles } from '../src/pager.ts';

const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const cacheRoot = option('cache', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache'));
const jobs = Number(option('jobs', '2'));
// --dry-run: только показать, какие полосы будут размечаться и сколько в них сообщений.
const dryRun = args.includes('--dry-run');
const exists = path => access(path).then(() => true, () => false);

const isPager = (sheet, article) =>
  sheet.result?.pageType === 'pager' || /пейджер|pager/i.test(`${article.rubric ?? ''} ${article.title ?? ''}`);

const prompt = messages => `Ниже сообщения из рубрики «Пейджер» молодёжной газеты 2000 года (JSON: i — номер, title — заголовок, если есть, text — текст, byline — подпись, если отделена).
Для каждого сообщения определи:
- to — кому адресовано: имена, прозвища, классы, группы, школы, как названы в начале текста или в обращениях, в именительном падеже («Гучеву Косте» → «Костя Гучев», «8Бе СШ 8» → «8 «Б» СШ 8»); несколько адресатов — несколько строк; «всем» — если адресовано всем; пустой список, если адресата нет;
- from — подпись автора без точки в конце (из byline, а если её нет — из конца текста); null, если подписи нет.
Ничего не выдумывай и не переводи прозвища. Ответь только JSON-массивом без пояснений: [{"i": 0, "to": ["…"], "from": "…"}].

${JSON.stringify(messages)}`;

function parseArray(text) {
  const body = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  return JSON.parse(body.slice(body.indexOf('['), body.lastIndexOf(']') + 1));
}

// Разметка полосы кэшируется в pager-NN.json. Старый формат — массив меток: годится, только если
// полосу не пришлось резать (тогда сообщения те же, что при старой разметке). Новый —
// { count, labels }: годится, пока число сообщений полосы не изменилось. Большие полосы
// размечаются кусками по CHUNK сообщений; готовые куски лежат в pager-NN.part-K.json.
const CHUNK = 60;
const tasks = [];
const issues = (await readdir(cacheRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && /^\d{4}-/.test(entry.name)).map(entry => entry.name).sort();
for (const issue of issues) {
  const files = (await readdir(join(cacheRoot, issue))).filter(name => /^sheet-\d+\.json$/.test(name)).sort();
  for (const file of files) {
    const sheet = JSON.parse(await readFile(join(cacheRoot, issue, file), 'utf8'));
    if (sheet.status !== 'ok') continue;
    // Материалы не из пейджера остаются пустыми: номер материала (article) совпадает с sheet-NN.json.
    const articles = (sheet.result.articles ?? []).map(article => (isPager(sheet, article) ? article : {}));
    const messages = splitArticles(articles);
    if (messages.length) tasks.push({ issue, file, sheet, messages, glued: articles.filter(isGlued).length });
  }
}

const hashOf = value => createHash('sha1').update(JSON.stringify(value)).digest('hex').slice(0, 12);
const readJson = async path => ((await exists(path)) ? JSON.parse(await readFile(path, 'utf8')) : null);
const cachePath = task => join(cacheRoot, task.issue, task.file.replace('sheet-', 'pager-'));
const cachedLabels = (task, cached) => {
  if (Array.isArray(cached) && !task.glued) return cached;
  if (cached?.count === task.messages.length) return cached.labels;
  return null;
};

async function label(task) {
  const out = cachePath(task);
  const cached = cachedLabels(task, await readJson(out));
  if (cached) return cached;
  const labels = [];
  for (let from = 0; from < task.messages.length; from += CHUNK) {
    const input = task.messages.slice(from, from + CHUNK).map((message, i) => ({
      i: from + i,
      ...(message.title ? { title: message.title } : {}),
      text: message.text,
      byline: message.byline,
    }));
    const part = out.replace(/\.json$/, `.part-${from / CHUNK}.json`);
    const hash = hashOf(input);
    const done = await readJson(part);
    if (done?.hash === hash) {
      labels.push(...done.labels);
      continue;
    }
    const { stdout } = await run('claude', ['-p', prompt(input), '--output-format', 'json'], { maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 });
    const response = JSON.parse(stdout);
    if (response.is_error) throw new Error(`${task.issue}/${task.file}: ${response.result}`);
    const chunk = parseArray(response.result);
    await writeFile(part, JSON.stringify({ hash, labels: chunk }, null, 2));
    console.log(`${task.issue}/${task.file}: messages ${from}–${from + input.length - 1} labelled`);
    labels.push(...chunk);
  }
  await writeFile(out, JSON.stringify({ count: task.messages.length, labels }, null, 2));
  return labels;
}

if (dryRun) {
  for (const task of tasks) {
    const cached = cachedLabels(task, await readJson(cachePath(task)));
    console.log(`${task.issue}/${task.file}: ${task.messages.length} messages${task.glued ? `, ${task.glued} glued articles split` : ''}${cached ? '' : ' — to label'}`);
  }
  process.exit(0);
}

const queue = [...tasks];
const results = new Map();
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    for (let task = queue.shift(); task; task = queue.shift()) {
      try {
        results.set(task, await label(task));
      } catch (error) {
        console.warn(`skip ${task.issue}/${task.file}: ${error.message}`);
      }
    }
  }),
);

// id — выпуск, полоса и номер сообщения на полосе в порядке чтения: при пересборке не
// меняется, пока не меняются распознавание полосы (sheet-NN.json) и правила разрезки.
const index = [];
for (const task of tasks) {
  const labels = results.get(task);
  if (!labels) continue;
  const byI = new Map(labels.map(label => [label.i, label]));
  task.messages.forEach((message, i) => {
    const label = byI.get(i) ?? { to: [], from: null };
    index.push({
      id: messageId(task.sheet, task.sheet.sheet, i + 1),
      year: task.sheet.year,
      number: task.sheet.number,
      serial: task.sheet.serial,
      date: task.sheet.date,
      sheet: task.sheet.sheet,
      article: message.article,
      seq: message.seq,
      title: message.title,
      to: label.to ?? [],
      from: label.from ?? message.byline ?? null,
      byline: message.byline,
      text: message.text,
    });
  });
}
await writeFile(join(cacheRoot, 'pager-index.json'), JSON.stringify(index, null, 2));
console.log(`Pager index: ${index.length} messages from ${results.size} of ${tasks.length} pages → ${join(cacheRoot, 'pager-index.json')}`);
