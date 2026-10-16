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
const cacheRoot = option('cache', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache'));
const jobs = Number(option('jobs', '3'));
// Русская модель tesseract (rus.traineddata из tessdata_best) лежит в кэше, системная установка не нужна.
const tessdata = option('tessdata', process.env.TESSDATA_PREFIX ?? join(cacheRoot, 'tessdata'));

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

// Плотную полосу (пейджер целиком) Claude иногда отказывается переписывать — «слишком длинный
// фрагмент», а на ужатой картинке мелкий шрифт не читается. Тогда режем полосу на вертикальные
// полосы с нахлёстом при 300 dpi и читаем по кускам, пересчитывая рамки в проценты полосы.
const STRIPS = 3;
const OVERLAP = 0.04;

async function readTextInStrips(page) {
  const full = join(dir, `page-${pad(page)}-strips.png`);
  await render(page, 300, full);
  const { stdout: size } = await run('magick', ['identify', '-format', '%w %h', full]);
  const [width, height] = size.split(' ').map(Number);
  const articles = [];
  let pageType = 'regular';
  for (let index = 0; index < STRIPS; index += 1) {
    const left = Math.max(0, index / STRIPS - OVERLAP);
    const right = Math.min(1, (index + 1) / STRIPS + OVERLAP);
    const strip = join(dir, `page-${pad(page)}-strip${index + 1}.jpg`);
    await run('magick', [full, '-crop', `${Math.round((right - left) * width)}x${height}+${Math.round(left * width)}+0`, '+repage', '-quality', '88', strip]);
    const note = `\n\nЭто вертикальная полоса ${index + 1} из ${STRIPS} одной газетной полосы (от ${Math.round(left * 100)}% до ${Math.round(right * 100)}% ширины), полное разрешение. Перепиши только материалы, которые целиком или в основном находятся в этой полосе; материалы, обрезанные краем, пропусти — их перепишут из соседней полосы. Рамки box указывай в процентах ЭТОЙ полосы.`;
    const { stdout } = await run('claude', ['-p', prompt.replace('{{IMAGE}}', strip) + note, '--allowedTools', 'Read', '--output-format', 'json'], { maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 });
    const response = JSON.parse(stdout);
    if (response.is_error) throw new Error(response.result);
    const result = parseJson(response.result);
    if (result.pageType && result.pageType !== 'regular') pageType = result.pageType;
    for (const article of result.articles ?? []) {
      if (Array.isArray(article.box)) {
        const [l, t, r, b] = article.box;
        article.box = [left * 100 + (l * (right - left)), t, left * 100 + (r * (right - left)), b].map(v => Math.round(v * 10) / 10);
      }
      // Нахлёст: один материал мог попасть в две полосы — оставляем первое вхождение.
      const key = (article.text ?? '').slice(0, 80);
      if (!articles.some(other => (other.text ?? '').slice(0, 80) === key)) articles.push(article);
    }
    await rm(strip);
  }
  await rm(full);
  return { pageType, articles };
}

async function readText(page) {
  const out = join(dir, `sheet-${pad(page)}.json`);
  if (await exists(out)) return 'cached';
  if (await exists(join(dir, `failed-${pad(page)}.txt`))) {
    // Целиком уже не получилось — пробуем по полосам.
    const started = Date.now();
    try {
      const result = await readTextInStrips(page);
      await writeFile(out, JSON.stringify({ ...issue, sheet: page, printedPage: null, model: 'claude-code-strips', durationMs: Date.now() - started, status: 'ok', result }, null, 2));
      await rm(join(dir, `failed-${pad(page)}.txt`));
      return 'ok (strips)';
    } catch (error) {
      return `failed in strips: ${error.message}`;
    }
  }
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
    const result = parseJson(response.result);
    // Плотный пейджер Claude иногда «распознаёт» без текстов — это тот же отказ: в следующий
    // прогон полоса прочитается по частям.
    const textLength = (result.articles ?? []).reduce((sum, article) => sum + (article.text ?? '').length, 0);
    if (result.pageType === 'pager' && textLength < 500) throw new Error(`pager page with only ${textLength} characters of text`);
    await writeFile(out, JSON.stringify({ ...sheet, status: 'ok', result }, null, 2));
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
