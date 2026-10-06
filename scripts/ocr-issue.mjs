// Полнотекстовое распознавание выпуска для проверки рисков и закраски.
//
//   node scripts/ocr-issue.mjs "<путь к PDF>" [--pages 6,7] [--jobs 3] [--cache <dir>]
//
// Для каждой полосы:
//   page-NN.jpg   — рендер 200 dpi, его читает Claude;
//   sheet-NN.json — текст по материалам (`claude -p`, расходует лимиты подписки Claude Code),
//                   в формате кэша подписей авторов, поэтому его читает scan-risks.mjs;
//   words-NN.tsv  — слова с координатами при 300 dpi (tesseract), по ним ставятся плашки.
// Уже готовые файлы не пересчитываются: прогон можно прервать и продолжить.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';

const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const pdf = args.find(arg => arg.endsWith('.pdf'));
if (!pdf) throw new Error('Usage: node scripts/ocr-issue.mjs <issue.pdf> [--pages 6,7] [--jobs 3]');
const cacheRoot = option('cache', join(homedir(), 'Downloads/pilot-archive-fulltext-cache'));
const jobs = Number(option('jobs', '3'));
const tessdata = option('tessdata', process.env.TESSDATA_PREFIX ?? '');

// «ПП №01(0066)-5.01.2000.pdf»
const match = basename(pdf).match(/№\s*(\d+)\s*\((\d+)\)\s*-\s*(\d{1,2})\.(\d{1,2})\.(\d{4})/);
if (!match) throw new Error(`Cannot parse issue number and date from ${basename(pdf)}`);
const [, number, serial, day, month, year] = match;
const issue = {
  year: Number(year),
  number: number.padStart(2, '0'),
  serial: serial.padStart(4, '0'),
  date: `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`,
};
const dir = join(cacheRoot, `${issue.year}-${issue.number}-${issue.serial}`);
await mkdir(dir, { recursive: true });

const { stdout: info } = await run('pdfinfo', [pdf]);
const pageCount = Number(info.match(/^Pages:\s+(\d+)/m)[1]);
const pages = option('pages', '')
  ? option('pages', '').split(',').map(Number)
  : Array.from({ length: pageCount }, (_, index) => index + 1);
const prompt = await readFile(new URL('./ocr-prompt.md', import.meta.url), 'utf8');
const exists = path => access(path).then(() => true, () => false);
const pad = page => String(page).padStart(2, '0');

async function render(page, dpi, path) {
  if (await exists(path)) return;
  const prefix = path.replace(/\.(jpg|png)$/, '');
  const format = path.endsWith('.png') ? ['-png'] : ['-jpeg', '-jpegopt', 'quality=85'];
  await run('pdftoppm', ['-f', String(page), '-l', String(page), '-r', String(dpi), '-singlefile', ...format, pdf, prefix]);
}

function parseJson(text) {
  const body = text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  return JSON.parse(body.slice(body.indexOf('{'), body.lastIndexOf('}') + 1));
}

async function readText(page) {
  const out = join(dir, `sheet-${pad(page)}.json`);
  if (await exists(out)) return 'cached';
  const image = join(dir, `page-${pad(page)}.jpg`);
  await render(page, 200, image);
  const started = Date.now();
  const { stdout } = await run(
    'claude',
    ['-p', prompt.replace('{{IMAGE}}', image), '--allowedTools', 'Read', '--output-format', 'json'],
    { maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 },
  );
  const response = JSON.parse(stdout);
  const sheet = { ...issue, sheet: page, printedPage: null, model: 'claude-code', durationMs: Date.now() - started };
  try {
    if (response.is_error) throw new Error(response.result);
    await writeFile(out, JSON.stringify({ ...sheet, status: 'ok', result: parseJson(response.result) }, null, 2));
    return 'ok';
  } catch (error) {
    // Ответ сохраняем рядом, чтобы разобрать сбой, но sheet-NN.json не пишем: следующий прогон повторит полосу.
    await writeFile(join(dir, `failed-${pad(page)}.txt`), String(response.result ?? error));
    return `failed: ${error.message}`;
  }
}

async function readWords(page) {
  const out = join(dir, `words-${pad(page)}.tsv`);
  if (await exists(out)) return;
  const image = join(dir, `page-${pad(page)}-300.png`);
  await render(page, 300, image);
  const env = tessdata ? { ...process.env, TESSDATA_PREFIX: tessdata } : process.env;
  await run('tesseract', [image, out.replace(/\.tsv$/, ''), '-l', 'rus', '--psm', '3', '-c', 'tessedit_create_tsv=1'], { env });
  await rm(image);
}

const queue = [...pages];
await Promise.all(
  Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    for (let page = queue.shift(); page !== undefined; page = queue.shift()) {
      const [text] = await Promise.all([readText(page), readWords(page)]);
      console.log(`page ${pad(page)}: ${text}`);
    }
  }),
);
console.log(`Issue ${issue.number} (${issue.serial}): ${dir}`);
