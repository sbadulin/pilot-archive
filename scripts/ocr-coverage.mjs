// Проверка распознанной полосы по tesseract.
//
// Claude иногда не переписывает полосу, а сокращает её: «[продолжение не приводится]» в длинной
// перепечатке, «[неразборчиво]» на целом пейджере (Sonnet, № 49 и 52 за 2000 год). Сам ответ при
// этом выглядит исправным. Tesseract читает ту же полосу независимо: берём его уверенные слова
// (от 5 букв, уверенность от 85) и смотрим, какая их доля есть в тексте Claude. На нормальных
// полосах это 80–90 %, на сокращённых 2–8 %.
//
// Запуск вручную: node scripts/ocr-coverage.mjs 2000-49-0114 [2000-52-0117 …]

import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

/** Ниже этой доли полоса считается сокращённой и перечитывается. */
export const MIN_COVERAGE = 0.3;
/** На полосах, где tesseract уверенно прочитал меньше слов (фото, реклама), проверка ничего не значит. */
const MIN_WORDS = 80;

const wordsOf = text => text.toLowerCase().replace(/ё/g, 'е').match(/[а-я]{5,}/g) ?? [];

/** @returns {{ words: number, coverage: number, checked: boolean }} */
export function sheetCoverage(result, tsv) {
  const text = (result?.articles ?? []).map(a => [a.rubric, a.title, a.byline, a.text].filter(Boolean).join(' ')).join(' ');
  const claude = new Set(wordsOf(text));
  const rows = tsv.split('\n').slice(1).map(line => line.split('\t'));
  const tess = [...new Set(rows.filter(cells => Number(cells[10]) >= 85).flatMap(cells => wordsOf(cells[11] ?? '')))];
  const coverage = tess.length ? tess.filter(word => claude.has(word)).length / tess.length : 1;
  return { words: tess.length, coverage, checked: tess.length >= MIN_WORDS && result?.pageType !== 'tv' };
}

export const isShortened = ({ checked, coverage }) => checked && coverage < MIN_COVERAGE;

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache');
  for (const issue of process.argv.slice(2)) {
    const dir = join(root, issue);
    const lines = [];
    for (const file of (await readdir(dir)).filter(name => /^sheet-\d+\.json$/.test(name)).sort()) {
      const n = file.slice(6, 8);
      const sheet = JSON.parse(await readFile(join(dir, file), 'utf8'));
      const tsv = await readFile(join(dir, `words-${n}.tsv`), 'utf8').catch(() => '');
      const check = sheetCoverage(sheet.result, tsv);
      if (check.checked && check.coverage < 0.8) {
        lines.push(`  sheet ${n} ${sheet.result.pageType} ${sheet.modelId ?? sheet.model}: ${(check.coverage * 100).toFixed(0)}% of ${check.words}${isShortened(check) ? ' — SHORTENED' : ''}`);
      }
    }
    console.log(`${issue}: ${lines.length ? `\n${lines.join('\n')}` : 'all sheets ≥ 80%'}`);
  }
}
