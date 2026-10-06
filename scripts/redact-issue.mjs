// Закраска фрагментов выпуска по списку решений куратора.
//
//   node scripts/redact-issue.mjs "<путь к PDF>"            # review.html с красными рамками
//   node scripts/redact-issue.mjs "<путь к PDF>" --apply    # PDF с плашками, только approved
//
// Решения лежат в <кэш выпуска>/redactions.json (кэш — см. ocr-issue.mjs):
//   { "items": [
//     { "sheet": 6, "find": "садомазо", "reason": "…", "approved": true },      // слово или фраза
//     { "sheet": 9, "article": "Сатанист или бизнесмен", "approved": false },   // материал целиком
//     { "sheet": 2, "box": [10, 20, 40, 30] }                                   // проценты полосы
//   ] }
// Слова ищутся в words-NN.tsv (tesseract, 300 dpi), рамка материала — в sheet-NN.json.
// Закраска делается в пикселях полосы, а не поверх неё: исходного изображения в новом
// PDF нет. Исходный PDF не меняется; результат пишется рядом с кэшем.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir, tmpdir } from 'node:os';

const run = promisify(execFile);
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const pdf = args.find(arg => arg.endsWith('.pdf'));
if (!pdf) throw new Error('Usage: node scripts/redact-issue.mjs <issue.pdf> [--apply]');
const apply = args.includes('--apply');
const cacheRoot = option('cache', join(homedir(), 'Downloads/pilot-archive-fulltext-cache'));
const match = basename(pdf).match(/№\s*(\d+)\s*\((\d+)\)\s*-\s*\d{1,2}\.\d{1,2}\.(\d{4})/);
if (!match) throw new Error(`Cannot parse issue from ${basename(pdf)}`);
const dir = join(cacheRoot, `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(4, '0')}`);
const spec = JSON.parse(await readFile(join(dir, 'redactions.json'), 'utf8'));
const pad = page => String(page).padStart(2, '0');
const DPI = 300;
const INK = '#2b2c27';
const PAPER = '#f5f4ee';
const font = option('font', '/System/Library/Fonts/Supplemental/PTSans.ttc');

const { stdout: info } = await run('pdfinfo', ['-f', '1', '-l', '999', pdf]);
const pageSize = page => {
  const found = info.match(new RegExp(`^Page\\s+${page} size:\\s+([\\d.]+) x ([\\d.]+)`, 'm'));
  return { width: Math.round((Number(found[1]) * DPI) / 72), height: Math.round((Number(found[2]) * DPI) / 72) };
};

const normalize = word => word.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}-]/gu, '');

async function readWords(sheet) {
  const tsv = await readFile(join(dir, `words-${pad(sheet)}.tsv`), 'utf8');
  return tsv
    .split('\n')
    .slice(1)
    .map(line => line.split('\t'))
    .filter(cols => cols[0] === '5' && cols[11]?.trim())
    .map(cols => ({
      line: cols.slice(2, 5).join('.'),
      left: Number(cols[6]),
      top: Number(cols[7]),
      right: Number(cols[6]) + Number(cols[8]),
      bottom: Number(cols[7]) + Number(cols[9]),
      word: normalize(cols[11]),
    }));
}

// Фраза может начинаться с середины строки и переходить на следующую, в том числе через
// перенос («садо-» / «мазо»). Тире и одиночные знаки после нормализации пусты: при сравнении
// они пропускаются, но в рамку попадают, в том числе висящие в конце строки («подонки, –»).
// Возвращает по прямоугольнику на каждую задетую строку.
function findPhrase(words, phrase) {
  const target = phrase.split(/\s+/).map(normalize).filter(Boolean).join(' ');
  for (let start = 0; start < words.length; start += 1) {
    if (!words[start].word) continue;
    let text = '';
    for (let end = start; end < words.length && text.length <= target.length; end += 1) {
      const word = words[end].word;
      if (!word) continue;
      text = text.endsWith('-') ? text.slice(0, -1) + word : text ? `${text} ${word}` : word;
      const done = text === target || (text.startsWith(target) && end === start);
      if (!done) continue;
      let last = end;
      while (words[last + 1] && !words[last + 1].word && words[last + 1].line === words[last].line) last += 1;
      const lines = new Map();
      for (const item of words.slice(start, last + 1)) {
        const box = lines.get(item.line);
        lines.set(item.line, box
          ? { left: Math.min(box.left, item.left), top: Math.min(box.top, item.top), right: Math.max(box.right, item.right), bottom: Math.max(box.bottom, item.bottom) }
          : { ...item });
      }
      return [...lines.values()];
    }
  }
  return [];
}

async function boxesFor(item) {
  const size = pageSize(item.sheet);
  const fromPercent = ([left, top, right, bottom]) => ({
    left: Math.round((left * size.width) / 100),
    top: Math.round((top * size.height) / 100),
    right: Math.round((right * size.width) / 100),
    bottom: Math.round((bottom * size.height) / 100),
  });
  if (item.box) return { boxes: [fromPercent(item.box)], label: true };
  if (item.article) {
    const sheet = JSON.parse(await readFile(join(dir, `sheet-${pad(item.sheet)}.json`), 'utf8'));
    const article = sheet.result.articles.find(entry => (entry.title ?? '').toLowerCase().includes(item.article.toLowerCase()));
    if (!article?.box) throw new Error(`Sheet ${item.sheet}: no article titled «${item.article}»`);
    return { boxes: [fromPercent(article.box)], label: true };
  }
  const found = findPhrase(await readWords(item.sheet), item.find);
  if (!found.length) throw new Error(`Sheet ${item.sheet}: «${item.find}» not found by tesseract; give a "box" instead`);
  // Запас, чтобы не остались края букв.
  return { boxes: found.map(box => ({ left: box.left - 5, top: box.top - 6, right: box.right + 5, bottom: box.bottom + 6 })), label: false };
}

// Статус решения: approved — закрасить; keep — рассмотрено и оставлено; иначе ждёт решения.
const status = item => (item.approved ? 'ok' : item.keep ? 'keep' : 'wait');
const colors = { ok: '#d0261b', keep: '#8c8a83', wait: '#e08a00' };
const statusLabels = { ok: 'Закрасить', keep: 'Оставить', wait: 'Ждёт решения' };
const items = [];
for (const [index, item] of spec.items.entries()) items.push({ ...item, number: index + 1, ...(await boxesFor(item)) });
const sheets = [...new Set(items.map(item => item.sheet))].sort((a, b) => a - b);
const work = await mkdtemp(join(tmpdir(), 'redact-'));

async function renderPage(sheet, dpi) {
  const prefix = join(work, `page-${pad(sheet)}-${dpi}`);
  await run('pdftoppm', ['-f', String(sheet), '-l', String(sheet), '-r', String(dpi), '-singlefile', '-png', pdf, prefix]);
  return `${prefix}.png`;
}

if (!apply) {
  // Превью в 120 dpi: красные рамки с номерами решений.
  const scale = 120 / DPI;
  const out = join(dir, 'review');
  await mkdir(out, { recursive: true });
  for (const sheet of sheets) {
    const draw = items
      .filter(item => item.sheet === sheet)
      .flatMap(item => item.boxes.flatMap(box => [
        '-stroke', colors[status(item)], '-strokewidth', '3', '-fill', 'none',
        '-draw', `rectangle ${Math.round(box.left * scale)},${Math.round(box.top * scale)} ${Math.round(box.right * scale)},${Math.round(box.bottom * scale)}`,
        '-stroke', 'none', '-fill', colors[status(item)], '-font', font, '-pointsize', '22',
        '-annotate', `+${Math.round(box.right * scale) + 4}+${Math.round(box.top * scale) + 18}`, String(item.number),
      ]));
    await run('magick', [await renderPage(sheet, 120), ...draw, '-quality', '82', join(out, `sheet-${pad(sheet)}.jpg`)]);
  }
  const escape = value => String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Закраска на одобрение</title>
<style>body{margin:0 auto;max-width:1000px;padding:24px 16px;font:15px/1.45 system-ui,sans-serif;background:#fbfaf7;color:#1d1b18}
h1{font-size:22px}h2{font-size:17px;margin:32px 0 8px}img{width:100%;border:1px solid #ddd8cf}ol{padding-left:20px}li{margin:6px 0}
.ok{color:#d0261b;font-weight:600}.wait{color:#b46a00;font-weight:600}.keep{color:#8c8a83;font-weight:600}small{color:#6b665e}</style></head><body>
<h1>Закраска на одобрение</h1>
<p>Красная рамка — будет закрашено, серая — рассмотрено и оставлено, оранжевая — ждёт решения. Номер рядом с рамкой — номер в списке.</p>
${sheets.map(sheet => `<h2>Лист ${sheet}</h2><ol>${items.filter(item => item.sheet === sheet).map(item => `<li value="${item.number}"><span class="${status(item)}">${statusLabels[status(item)]}</span> · ${escape(item.find ? `слово или фраза «${item.find}»` : item.article ? `материал «${item.article}» целиком` : 'область')}<br><small>${escape(item.reason)}</small></li>`).join('')}</ol><img src="review/sheet-${pad(sheet)}.jpg" alt="Лист ${sheet}">`).join('')}
</body></html>`;
  await writeFile(join(dir, 'review.html'), html);
  console.log(`${items.length} decisions on ${sheets.length} sheets, ${items.filter(item => item.approved).length} approved, ${items.filter(item => item.keep).length} kept. Review: ${join(dir, 'review.html')}`);
} else {
  const approved = items.filter(item => item.approved);
  const changed = [...new Set(approved.map(item => item.sheet))];
  await run('pdfseparate', [pdf, join(work, 'orig-%03d.pdf')]);
  for (const sheet of changed) {
    const draw = approved
      .filter(item => item.sheet === sheet)
      .flatMap(item => item.boxes.flatMap(box => {
        const fill = ['-fill', INK, '-draw', `rectangle ${box.left},${box.top} ${box.right},${box.bottom}`];
        const roomy = item.label && box.bottom - box.top > 160 && box.right - box.left > 600;
        const label = roomy
          ? ['-fill', PAPER, '-font', font, '-pointsize', '64', '-gravity', 'NorthWest',
             '-annotate', `+${Math.round((box.left + box.right) / 2 - 290)}+${Math.round((box.top + box.bottom) / 2 - 36)}`, 'Фрагмент недоступен']
          : [];
        return [...fill, ...label];
      }));
    const redacted = join(work, `redacted-${pad(sheet)}.png`);
    await run('magick', [await renderPage(sheet, DPI), ...draw, redacted]);
    // Новая страница — только картинка с плашками: прежнего изображения полосы в ней нет.
    await run('magick', [redacted, '-units', 'PixelsPerInch', '-density', String(DPI), '-compress', 'jpeg', '-quality', '85', join(work, `orig-${String(sheet).padStart(3, '0')}.pdf`)]);
  }
  const parts = (await readdir(work)).filter(name => /^orig-\d{3}\.pdf$/.test(name)).sort().map(name => join(work, name));
  const output = option('out', join(dir, basename(pdf).replace(/\.pdf$/, ' (публичная версия).pdf')));
  await run('pdfunite', [...parts, output]);
  console.log(`Redacted ${approved.length} decisions on sheets ${changed.join(', ')}: ${output}`);
}
await rm(work, { recursive: true, force: true });
