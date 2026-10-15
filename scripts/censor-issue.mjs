// Цензурированная версия выпуска одной командой; её можно запускать сколько угодно раз.
//
//   npm run censor -- "<путь к PDF>" [ещё PDF…]   # распознать, найти, обновить решения, review.html
//   npm run censor -- "<путь к PDF>" --apply      # то же и собрать публичную версию PDF
//   npm run censor -- --all [--apply]             # заново по всем выпускам кэша
//
// Шаги:
//   1. ocr-issue.mjs — полный текст и координаты слов (готовые полосы берутся из кэша);
//   2. словарь src/riskTerms.ts — находки по каждому материалу. Для материалов, которые Claude
//      пересказал или не переписал (песни, перепечатки), текст берётся у tesseract;
//   3. находки сливаются с redactions.json: новые добавляются как «ждёт решения», принятые
//      решения (approved / keep) не трогаются, нерешённые находки, которых словарь больше
//      не выдаёт, удаляются;
//   4. redact-issue.mjs — страница на одобрение, с --apply — публичная версия из оригинала.
// Поэтому после правки словаря или scripts/redaction-rules.json достаточно запустить
// команду заново: решатся только новые находки, остальное пересоберётся само.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { homedir } from 'node:os';
import { findRisks, mentionsMinor, recommendAction, riskActionLabels, riskCategoryLabels } from '../src/riskTerms.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const apply = args.includes('--apply');
const cacheRoot = option('cache', join(homedir(), 'Downloads/pilot-archive-fulltext-cache'));
const exists = path => access(path).then(() => true, () => false);
const pad = page => String(page).padStart(2, '0');
// Находки, по которым нужно решение. «Оставить с 18+» и «Посмотреть» остаются только в отчёте сканера.
const needsDecision = new Set(['redact', 'redactMinor', 'read', 'pointwise']);

function issueDir(pdf) {
  const match = basename(pdf).match(/№\s*(\d+)\s*\((\d+)\)\s*-\s*\d{1,2}\.\d{1,2}\.(\d{4})/);
  if (!match) throw new Error(`Cannot parse issue from ${basename(pdf)}`);
  return join(cacheRoot, `${match[3]}-${match[1].padStart(2, '0')}-${match[2].padStart(4, '0')}`);
}

function step(script, scriptArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, script), ...scriptArgs, '--cache', cacheRoot], { stdio: 'inherit' });
    child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${script} exited with ${code}`))));
  });
}

// Claude не переписывает дословно песни и перепечатки: в тексте тогда пометка в квадратных скобках.
const isRetold = article => /^\s*\[|\[(?:краткое|текст|пересказ)/i.test(article.text ?? '');

async function tesseractText(dir, sheet, box) {
  const tsv = await readFile(join(dir, `words-${pad(sheet)}.tsv`), 'utf8');
  const rows = tsv.split('\n').slice(1).map(line => line.split('\t')).filter(cols => cols[0] === '5' && cols[11]?.trim());
  const width = Math.max(...rows.map(cols => Number(cols[6]) + Number(cols[8])));
  const height = Math.max(...rows.map(cols => Number(cols[7]) + Number(cols[9])));
  const [left, top, right, bottom] = box ?? [0, 0, 100, 100];
  return rows
    .filter(cols => {
      const x = ((Number(cols[6]) + Number(cols[8]) / 2) * 100) / width;
      const y = ((Number(cols[7]) + Number(cols[9]) / 2) * 100) / height;
      return x >= left && x <= right && y >= top && y <= bottom;
    })
    .map(cols => cols[11])
    .join(' ');
}

async function findCandidates(dir) {
  const candidates = [];
  const sheets = (await readdir(dir)).filter(name => /^sheet-\d+\.json$/.test(name)).sort();
  for (const file of sheets) {
    const sheet = JSON.parse(await readFile(join(dir, file), 'utf8'));
    if (sheet.status !== 'ok') continue;
    for (const article of sheet.result.articles ?? []) {
      const retold = isRetold(article);
      const text = [article.rubric, article.title, article.byline, retold ? await tesseractText(dir, sheet.sheet, article.box) : article.text]
        .filter(Boolean)
        .join('\n');
      const matches = findRisks(text);
      if (!matches.length) continue;
      const action = recommendAction(matches, { minor: mentionsMinor(text), ad: article.kind === 'ad' });
      if (!needsDecision.has(action)) continue;
      const inArticle = article.title ?? article.rubric ?? text.slice(0, 40);
      for (const match of matches) {
        if (match.weak) continue;
        const multiword = /\s/.test(match.term);
        const key = [sheet.sheet, match.category, match.term, inArticle].join('|');
        candidates.push({
          id: createHash('sha1').update(key).digest('hex').slice(0, 10),
          sheet: sheet.sheet,
          source: retold ? 'tesseract' : 'scanner',
          action,
          actionLabel: riskActionLabels[action],
          category: match.category,
          categoryLabel: riskCategoryLabels[match.category],
          inArticle,
          word: match.word,
          excerpt: match.excerpt,
          ...(multiword ? { find: match.word } : { stem: match.term.replace(/=$/, ''), whole: match.term.endsWith('='), within: article.box }),
        });
      }
    }
  }
  return candidates;
}

async function censor(pdf) {
  console.log(`\n== ${basename(pdf)}`);
  await step('ocr-issue.mjs', [pdf]);
  const dir = issueDir(pdf);
  const path = join(dir, 'redactions.json');
  const spec = (await exists(path)) ? JSON.parse(await readFile(path, 'utf8')) : { items: [] };
  spec.source = pdf;
  const candidates = await findCandidates(dir);
  const fresh = new Set(candidates.map(candidate => candidate.id));
  const decided = item => item.approved || item.keep;
  const before = spec.items.length;
  spec.items = spec.items.filter(item => !item.id || decided(item) || fresh.has(item.id));
  const dropped = before - spec.items.length;
  const known = new Set(spec.items.map(item => item.id).filter(Boolean));
  const added = candidates.filter(candidate => !known.has(candidate.id));
  spec.items.push(...added);
  await writeFile(path, JSON.stringify(spec, null, 2));
  const pending = spec.items.filter(item => !decided(item) && !item.name);
  console.log(`Findings: ${candidates.length}; new ${added.length}, dropped ${dropped}, waiting for a decision ${pending.length}.`);
  await step('redact-issue.mjs', [pdf, ...(apply ? ['--apply'] : [])]);
}

let pdfs = args.filter(arg => arg.endsWith('.pdf'));
if (args.includes('--all')) {
  const dirs = (await readdir(cacheRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && /^\d{4}-/.test(entry.name));
  for (const entry of dirs) {
    const path = join(cacheRoot, entry.name, 'redactions.json');
    if (!(await exists(path))) continue;
    const { source } = JSON.parse(await readFile(path, 'utf8'));
    if (source && (await exists(source))) pdfs.push(source);
    else console.warn(`${entry.name}: original PDF unknown or moved; run once with its path`);
  }
}
if (!pdfs.length) throw new Error('Usage: npm run censor -- <issue.pdf>… | --all [--apply]');
for (const pdf of pdfs) await censor(pdf);
