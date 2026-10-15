// Индекс рубрики «Пейджер»: у каждого сообщения — кому оно адресовано и кто подписал.
//
//   node scripts/pager-index.mjs [--jobs 2] [--cache <dir>]
//
// Берёт полнотекстовый кэш (ocr-issue.mjs): Claude уже разбил пейджер на отдельные сообщения,
// подпись обычно лежит в byline. Адресатов в начале текста размечает `claude -p` (подписка
// Claude Code) — по одному запросу на полосу, только текст, без картинок. Готовая разметка
// полосы хранится в pager-NN.json рядом с кэшем выпуска и не пересчитывается. Итог —
// pager-index.json в корне кэша: выпуск, дата, полоса, кому, от кого, текст. Отсюда потом
// можно сделать поиск по пейджеру на сайте; закрытые цензурой сообщения в него не выкладывать.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const cacheRoot = option('cache', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache'));
const jobs = Number(option('jobs', '2'));
const exists = path => access(path).then(() => true, () => false);

const isPager = (sheet, article) =>
  sheet.result?.pageType === 'pager' || /пейджер|pager/i.test(`${article.rubric ?? ''} ${article.title ?? ''}`);

const prompt = messages => `Ниже сообщения из рубрики «Пейджер» молодёжной газеты 2000 года (JSON: i — номер, text — текст, byline — подпись, если отделена).
Для каждого сообщения определи:
- to — кому адресовано: имена, прозвища, классы, группы, школы, как названы в начале текста или в обращениях, в именительном падеже («Гучеву Косте» → «Костя Гучев», «8Бе СШ 8» → «8 «Б» СШ 8»); несколько адресатов — несколько строк; «всем» — если адресовано всем; пустой список, если адресата нет;
- from — подпись автора без точки в конце (из byline, а если её нет — из конца текста); null, если подписи нет.
Ничего не выдумывай и не переводи прозвища. Ответь только JSON-массивом без пояснений: [{"i": 0, "to": ["…"], "from": "…"}].

${JSON.stringify(messages)}`;

function parseArray(text) {
  const body = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  return JSON.parse(body.slice(body.indexOf('['), body.lastIndexOf(']') + 1));
}

const tasks = [];
const issues = (await readdir(cacheRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && /^\d{4}-/.test(entry.name)).map(entry => entry.name).sort();
for (const issue of issues) {
  const files = (await readdir(join(cacheRoot, issue))).filter(name => /^sheet-\d+\.json$/.test(name)).sort();
  for (const file of files) {
    const sheet = JSON.parse(await readFile(join(cacheRoot, issue, file), 'utf8'));
    if (sheet.status !== 'ok') continue;
    const messages = (sheet.result.articles ?? [])
      .map((article, index) => ({ article, index }))
      .filter(({ article }) => isPager(sheet, article) && article.text?.trim());
    if (messages.length) tasks.push({ issue, file, sheet, messages });
  }
}

async function label(task) {
  const out = join(cacheRoot, task.issue, task.file.replace('sheet-', 'pager-'));
  if (await exists(out)) return JSON.parse(await readFile(out, 'utf8'));
  const input = task.messages.map(({ article }, i) => ({ i, text: article.text, byline: article.byline ?? null }));
  const { stdout } = await run('claude', ['-p', prompt(input), '--output-format', 'json'], { maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  const response = JSON.parse(stdout);
  if (response.is_error) throw new Error(`${task.issue}/${task.file}: ${response.result}`);
  const labels = parseArray(response.result);
  await writeFile(out, JSON.stringify(labels, null, 2));
  console.log(`${task.issue}/${task.file}: ${labels.length} messages`);
  return labels;
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

const index = [];
for (const task of tasks) {
  const labels = results.get(task);
  if (!labels) continue;
  const byI = new Map(labels.map(label => [label.i, label]));
  task.messages.forEach(({ article }, i) => {
    const label = byI.get(i) ?? { to: [], from: null };
    index.push({
      year: task.sheet.year,
      number: task.sheet.number,
      serial: task.sheet.serial,
      date: task.sheet.date,
      sheet: task.sheet.sheet,
      to: label.to ?? [],
      from: label.from ?? article.byline ?? null,
      text: article.text,
    });
  });
}
await writeFile(join(cacheRoot, 'pager-index.json'), JSON.stringify(index, null, 2));
console.log(`Pager index: ${index.length} messages from ${results.size} of ${tasks.length} pages → ${join(cacheRoot, 'pager-index.json')}`);
