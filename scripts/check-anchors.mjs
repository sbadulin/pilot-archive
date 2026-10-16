// Проверяет, что все якоря одобренных решений выпуска (find, from, to) есть в тексте
// tesseract, и для ненайденных показывает, как tesseract прочитал это место.
//
//   node scripts/check-anchors.mjs 2000-06-0071
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';

const issue = process.argv[2];
if (!issue) throw new Error('Usage: node scripts/check-anchors.mjs <year-number-serial>');
const dir = join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache', issue);
const spec = JSON.parse(await readFile(join(dir, 'redactions.json'), 'utf8'));
const normalize = word => word.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}-]/gu, '');

const texts = new Map();
async function sheetText(sheet) {
  if (!texts.has(sheet)) {
    const tsv = await readFile(join(dir, `words-${String(sheet).padStart(2, '0')}.tsv`), 'utf8');
    const words = [];
    for (const line of tsv.split('\n').slice(1)) {
      const cols = line.split('\t');
      const word = cols[0] === '5' && cols[11] ? normalize(cols[11]) : '';
      if (!word) continue;
      // Перенос «са-» / «танизма» склеиваем, как это делает redact-issue.mjs.
      if (words.length && words.at(-1).endsWith('-')) words[words.length - 1] = words.at(-1).slice(0, -1) + word;
      else words.push(word);
    }
    texts.set(sheet, words.join(' '));
  }
  return texts.get(sheet);
}

let missing = 0;
for (const item of spec.items) {
  if (!item.approved || item.stem) continue;
  for (const key of ['find', 'from', 'to']) {
    if (!item[key]) continue;
    const text = await sheetText(item.sheet);
    const target = item[key].split(/\s+/).map(normalize).filter(Boolean).join(' ');
    if (text.includes(target)) continue;
    missing += 1;
    console.log(`MISS sheet ${item.sheet} ${key}: «${item[key]}»`);
    const first = target.split(' ')[0];
    let at = text.indexOf(first);
    for (let shown = 0; at >= 0 && shown < 3; shown += 1, at = text.indexOf(first, at + 1)) {
      console.log(`    …${text.slice(Math.max(0, at - 40), at + 120)}…`);
    }
  }
}
console.log(missing ? `${missing} anchors not found` : 'All anchors found');
