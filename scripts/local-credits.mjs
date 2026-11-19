// Author bylines of a staged issue from the local full-text recognition, written to D1 so that
// «Одобрить» finds every sheet already recognized and does not send the pages to the model again.
//
//   node --experimental-strip-types scripts/local-credits.mjs "<путь к PDF>"           # credits.sql, nothing sent
//   node --experimental-strip-types scripts/local-credits.mjs "<путь к PDF>" --apply   # also writes to D1
//
// Needs: `npm run censor -- "<PDF>"` done (sheet-NN.json and redactions.json in the cache). The raw
// bylines go through one text-only `claude -p` call (the Claude Code subscription) that cleans them
// into author names, the way the approval prompt does (functions/api/_lib/recognition.ts).
// Bylines the censor closed are left out, so they never reach the public search.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { spreadSheets } from './spreads.mjs';
import { printedPages } from '../src/readerLayout.ts';
import { creditId, creditsFromSheet } from '../src/authorNames.ts';
import { bylineEntries, captionEntries, closuresFrom, sheetResult } from '../src/localCredits.ts';

const run = promisify(execFile);
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const pdf = args.find((arg) => arg.endsWith('.pdf'));
if (!pdf) throw new Error('Usage: node --experimental-strip-types scripts/local-credits.mjs <issue.pdf> [--apply]');
const match = basename(pdf).match(/№\s*(\d+)\s*\((\d+)\)\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
if (!match) throw new Error(`Cannot parse issue number and date from ${basename(pdf)}`);
const [, rawNumber, rawSerial, , , rawYear] = match;
const issue = { year: Number(rawYear), number: rawNumber.padStart(2, '0'), serial: rawSerial.padStart(4, '0') };
const cacheRoot = join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache');
const dir = join(cacheRoot, `${issue.year}-${issue.number}-${issue.serial}`);
const MODEL = 'claude-code-local';

const { stdout: info } = await run('pdfinfo', [pdf]);
const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)[1]);
const files = new Set(await readdir(dir));
const sheets = [];
for (let n = 1; n <= pageCount; n++) {
  const file = `sheet-${String(n).padStart(2, '0')}.json`;
  // A missing sheet stays unrecognized: approval then recognizes just that one, as before.
  if (!files.has(file)) { console.warn(`sheet ${n}: no ${file}, left for approval`); continue; }
  sheets.push({ n, ocr: JSON.parse(await readFile(join(dir, file), 'utf8')).result });
}
const redactions = JSON.parse(await readFile(join(dir, 'redactions.json'), 'utf8'));
const rules = JSON.parse(await readFile(new URL('./redaction-rules.json', import.meta.url), 'utf8'));
const closures = closuresFrom(redactions.items ?? [], rules.names ?? []);

const bylines = sheets.flatMap(({ n, ocr }) => bylineEntries(n, ocr));
const captions = sheets.flatMap(({ n, ocr }) => captionEntries(n, ocr));

// One call for the whole issue: only the printed bylines and captions travel, not the pages.
const prompt = `Ниже подписи материалов и подписи к фото из одного выпуска молодёжной газеты «Первый Пилот» (2000 г.).
Для каждой подписи материала (bylines) выдели authors — чистые имена авторов без служебных слов («Прислала», «Беседовала», «Вопросы задавала», «Материал подготовил», «записали»), без возраста, школы, класса и города. Несколько авторов — отдельными элементами. Если подпись — не автор (адрес, телефон, «Реклама», название фирмы), верни пустой список. Примеры:
«Прислала Катя Иващенко, 12 лет.» → ["Катя Иващенко"]; «Откровение VIRUS'а записали Sly и Neo» → ["Sly", "Neo"]; «Беседовала Бланкита, г. Амурск» → ["Бланкита"]; «Ваша КАТЕРИНА» → ["КАТЕРИНА"]; «Девчата ПУ-33 г. Амурска» → ["Девчата ПУ-33"].
Люди, о которых написан материал, и цитируемые авторы — не авторы материала: исполнитель или группа под текстом песни («Аквариум», «Крематорий»), классик под цитатой → пустой список. Помогает title — заголовок или рубрика материала.
Для подписей к фото и рисункам (captions) выдели автора снимка или рисунка: kind "photo" или "drawing" и name — имя автора («Фото Ивана Петрова» → {"kind": "photo", "name": "Иван Петров"}). Если автора нет, пустой список.
Имена пиши так, как они напечатаны (регистр сохраняй), только приводи к именительному падежу.

${JSON.stringify({ bylines: bylines.map(({ id, title, byline }) => ({ id, title, byline })), captions: captions.map(({ id, text }) => ({ id, text })) })}

Ответь ТОЛЬКО JSON без пояснений и без markdown-ограды:
{"authors": {"<id>": ["…"]}, "credits": {"<id>": [{"kind": "photo" | "drawing", "name": "…"}]}}`;

let answer = { authors: {}, credits: {} };
if (bylines.length || captions.length) {
  const { stdout } = await run('claude', ['-p', prompt, '--output-format', 'json'], { maxBuffer: 16 * 1024 * 1024, timeout: 10 * 60 * 1000 });
  const response = JSON.parse(stdout);
  if (response.is_error) throw new Error(response.result);
  const body = String(response.result).trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  answer = JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
}

const printed = printedPages(pageCount, spreadSheets(pdf));
const sql = (value) => (value === null || value === undefined ? 'NULL' : `'${String(value).replace(/'/g, "''")}'`);
const now = new Date().toISOString();
const statements = [];
const credits = [];
for (const { n, ocr } of sheets) {
  const result = sheetResult(n, ocr, closures, answer.authors ?? {}, answer.credits ?? {});
  const found = creditsFromSheet(result, { ...issue, sheet: n, printedPage: printed.first(n), source: MODEL });
  credits.push(...found);
  statements.push(`INSERT OR REPLACE INTO recognition_runs (issue_year, issue_number, issue_serial, sheet, model, status, raw_json, created_at) VALUES (${issue.year}, ${sql(issue.number)}, ${sql(issue.serial)}, ${n}, ${sql(MODEL)}, 'ok', ${sql(JSON.stringify(result))}, ${sql(now)});`);
  for (const c of found)
    statements.push(`INSERT INTO credits (id, issue_year, issue_number, issue_serial, sheet, printed_page, kind, title, byline, name, name_key, source, status, created_at, updated_at) VALUES (${sql(await creditId(c))}, ${c.year}, ${sql(c.number)}, ${sql(c.serial)}, ${c.sheet}, ${c.printedPage}, ${sql(c.kind)}, ${sql(c.title)}, ${sql(c.byline)}, ${sql(c.name)}, ${sql(c.nameKey)}, ${sql(c.source)}, 'auto', ${sql(now)}, ${sql(now)}) ON CONFLICT(id) DO NOTHING;`);
}
// Curator corrections apply to these names too, as in the approval endpoint.
statements.push(`UPDATE credits SET name = f."right", name_key = f.right_key, updated_at = ${sql(now)} FROM name_fixes f WHERE credits.name = f.wrong AND credits.issue_year = ${issue.year} AND credits.issue_number = ${sql(issue.number)} AND credits.issue_serial = ${sql(issue.serial)};`);

const out = join(dir, 'credits.sql');
await writeFile(out, `${statements.join('\n')}\n`);
const closed = bylines.length - sheets.reduce((sum, { n, ocr }) => sum + sheetResult(n, ocr, closures, Object.fromEntries(bylines.map((b) => [b.id, ['x']])), {}).articles.length, 0);
console.log(`№${issue.number}(${issue.serial}): ${sheets.length} of ${pageCount} sheets, ${bylines.length} bylines (${closed} closed by the censor), ${captions.length} captions → ${credits.length} credits`);
for (const c of credits) console.log(`  стр. ${c.printedPage} ${c.kind}: ${c.name}${c.byline !== c.name ? `  ← «${c.byline}»` : ''}`);
console.log(`Wrote ${out}`);
if (!apply) {
  console.log('Nothing written to D1. Re-run with --apply.');
  process.exit(0);
}
await run('npx', ['wrangler', 'd1', 'execute', 'pilot_archive', '--remote', '--file', out], { maxBuffer: 16 * 1024 * 1024 });
console.log(`D1: ${sheets.length} sheets marked recognized, ${credits.length} credits added.`);
