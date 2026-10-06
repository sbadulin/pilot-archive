// Ищет в распознанном архиве материалы, которые по нынешним законам могут потребовать
// изъятия или маркировки, и пишет HTML-отчёт для куратора и юриста.
//
//   npm run risks:scan                                   # кэш подписей авторов → risk-report.html
//   npm run risks:scan -- --cache <dir> --out <file>
//
// Кэш — каталоги выпусков с sheet-NN.json (формат recognize-archive). Сейчас в кэше только
// заголовки и подписи; если у заметки есть поле `text` (полнотекстовое распознавание),
// оно проверяется тоже. Отчёт содержит цитаты из архива: в Git его не кладём.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { findRisks, mentionsMinor, recommendAction, riskActionLabels, riskCategoryLabels } from '../src/riskTerms.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const cacheDir = option('cache', join(homedir(), 'Downloads/pilot-archive-authors-cache'));
const output = option('out', 'risk-report.html');
const siteUrl = option('site', 'https://pilot-archive.ru').replace(/\/$/, '');

const issueDirs = (await readdir(cacheDir, { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort();

const findings = [];
const skipped = { pager: 0, tv: 0, failed: 0 };
let sheetCount = 0;
let articleCount = 0;
let fullText = false;
for (const dir of issueDirs) {
  const files = (await readdir(join(cacheDir, dir))).filter(name => /^sheet-\d+\.json$/.test(name)).sort();
  for (const file of files) {
    const sheet = JSON.parse(await readFile(join(cacheDir, dir, file), 'utf8'));
    sheetCount += 1;
    if (sheet.status !== 'ok') {
      skipped.failed += 1;
      continue;
    }
    const pageType = sheet.result?.pageType;
    if (pageType === 'pager' || pageType === 'tv') skipped[pageType] += 1;
    for (const article of sheet.result?.articles ?? []) {
      articleCount += 1;
      if (article.text) fullText = true;
      const fields = [
        ['заголовок', article.title],
        ['подпись', article.byline],
        ['текст', article.text],
      ].filter(([, value]) => typeof value === 'string' && value.trim());
      const matches = fields.flatMap(([field, value]) => findRisks(value).map(match => ({ ...match, field })));
      if (!matches.length) continue;
      const minor = fields.some(([, value]) => mentionsMinor(value));
      findings.push({ sheet, article, matches, minor, action: recommendAction(matches, minor) });
    }
  }
}

const escapeHtml = value =>
  String(value ?? '').replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]);
const pageLink = sheet => `${siteUrl}/#issue-${sheet.year}-${sheet.number}-${sheet.serial}-p${sheet.sheet}`;
const dateLabel = iso => new Date(`${iso}T00:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

const totals = Object.keys(riskCategoryLabels).map(category => {
  const inCategory = findings.filter(finding => finding.matches.some(match => match.category === category));
  return {
    category,
    strong: inCategory.filter(finding => finding.matches.some(match => match.category === category && !match.weak)).length,
    weak: inCategory.filter(finding => finding.matches.every(match => match.category !== category || match.weak)).length,
  };
});

const actionTotals = Object.keys(riskActionLabels).map(action => ({
  action,
  count: findings.filter(finding => finding.action === action).length,
}));

const byIssue = new Map();
for (const finding of findings) {
  const key = `${finding.sheet.year}-${finding.sheet.number}-${finding.sheet.serial}`;
  if (!byIssue.has(key)) byIssue.set(key, []);
  byIssue.get(key).push(finding);
}

const matchList = matches =>
  matches
    .map(
      match =>
        `<li class="${match.weak ? 'weak' : 'strong'}"><span class="tag">${escapeHtml(riskCategoryLabels[match.category])}${match.weak ? ' · слабое' : ''}</span> «${escapeHtml(match.term)}» в поле «${match.field}»${match.field === 'текст' ? `: <q>${escapeHtml(match.excerpt)}</q>` : ''}</li>`,
    )
    .join('');

const issueSections = [...byIssue.values()]
  .map(items => {
    const { sheet } = items[0];
    const rows = items
      .sort((a, b) => a.sheet.sheet - b.sheet.sheet)
      .map(
        ({ sheet, article, matches, minor, action }) => `
        <tr class="${action}">
          <td><a href="${pageLink(sheet)}" target="_blank" rel="noopener">лист ${sheet.sheet}</a>${sheet.printedPage && sheet.printedPage !== sheet.sheet ? `<br><small>с. ${escapeHtml(sheet.printedPage)}</small>` : ''}</td>
          <td><b>${escapeHtml(article.title || '(без заголовка)')}</b><br><small>${escapeHtml(article.kind === 'letter' ? 'письмо' : 'статья')}${article.byline ? ` · ${escapeHtml(article.byline)}` : ''}</small></td>
          <td><ul>${matchList(matches)}</ul></td>
          <td class="decision"><span class="action">${escapeHtml(riskActionLabels[action])}</span>${minor && action !== 'redactMinor' ? '<br><small>упомянут возраст до 18</small>' : ''}</td>
        </tr>`,
      )
      .join('');
    return `
    <section class="${items.every(item => item.action === 'review') ? 'review' : 'act'}">
      <h2>№ ${escapeHtml(sheet.number)} (${escapeHtml(sheet.serial)}) · ${escapeHtml(dateLabel(sheet.date))}</h2>
      <table>
        <thead><tr><th>Страница</th><th>Материал</th><th>Совпадения</th><th>Рекомендация</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
  })
  .join('');

const actionable = findings.filter(finding => finding.action !== 'review').length;
const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Риски архива</title>
<style>
  :root { --bg: #fbfaf7; --fg: #1d1b18; --muted: #6b665e; --line: #ddd8cf; --strong: #b4361f; --weak: #8a7a3a; --tag: #efebe3; }
  @media (prefers-color-scheme: dark) { :root { --bg: #171614; --fg: #ece8e1; --muted: #a29c92; --line: #3a3732; --strong: #ef7a62; --weak: #cdb86a; --tag: #2a2825; } }
  body { margin: 0 auto; max-width: 1100px; padding: 24px 16px 64px; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif; }
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 17px; margin: 32px 0 8px; }
  p.lead, small { color: var(--muted); }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; vertical-align: top; padding: 8px; border-top: 1px solid var(--line); }
  th { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
  td:first-child { white-space: nowrap; }
  td.decision { width: 150px; }
  .action { font-weight: 600; }
  tr.redact .action, tr.redactMinor .action { color: var(--strong); }
  tr.lawyer .action { color: var(--weak); }
  tr.adult .action, tr.review .action { color: var(--muted); }
  ul { margin: 0; padding: 0; list-style: none; }
  li + li { margin-top: 4px; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 4px; background: var(--tag); font-size: 12px; }
  li.strong .tag { color: var(--strong); font-weight: 600; }
  li.weak .tag { color: var(--weak); }
  q { color: var(--muted); }
  a { color: inherit; }
  .summary td:not(:first-child), .summary th:not(:first-child) { text-align: right; font-variant-numeric: tabular-nums; }
  .summary { max-width: 520px; }
  .summary + .summary { margin-top: 24px; }
  label { display: inline-flex; gap: 6px; align-items: center; margin: 16px 0 0; cursor: pointer; }
  body:has(#hide-review:checked) tr.review, body:has(#hide-review:checked) section.review { display: none; }
  .note { border-left: 3px solid var(--line); padding: 4px 12px; color: var(--muted); }
  @media print { label { display: none; } }
</style>
</head>
<body>
<h1>Риски архива «Первого Пилота»</h1>
<p class="lead">Проверено ${sheetCount} листов ${issueDirs.length} выпусков, ${articleCount} материалов. Под подозрением ${findings.length}, из них требуют действия ${actionable}. Сформировано ${new Date().toLocaleString('ru-RU')}.</p>
<p class="note">${fullText ? 'Проверены заголовки, подписи и полный текст заметок.' : 'Проверены только заголовки и подписи: полного текста в кэше нет, поэтому материал с нейтральным заголовком сюда не попадёт.'}
Листы «Пейджера» (${skipped.pager}) не распознавались и не проверены. Телепрограмма — ${skipped.tv} листов${skipped.failed ? `, не распознано ${skipped.failed} листов` : ''}.
Совпадение — повод посмотреть материал, а не вывод о нарушении. Рекомендация «Оставить с 18+» предполагает, что на сайте стоит возрастная маркировка.</p>
<table class="summary">
  <thead><tr><th>Рекомендация</th><th>Материалов</th></tr></thead>
  <tbody>${actionTotals.map(total => `<tr><td>${escapeHtml(riskActionLabels[total.action])}</td><td>${total.count}</td></tr>`).join('')}</tbody>
</table>
<table class="summary">
  <thead><tr><th>Категория</th><th>Сильные</th><th>Только слабые</th></tr></thead>
  <tbody>${totals.map(total => `<tr><td>${escapeHtml(riskCategoryLabels[total.category])}</td><td>${total.strong}</td><td>${total.weak}</td></tr>`).join('')}</tbody>
</table>
<label><input type="checkbox" id="hide-review"> Скрыть материалы с рекомендацией «Посмотреть»</label>
${issueSections || '<p>Совпадений нет.</p>'}
</body>
</html>
`;

await writeFile(output, html);
console.log(`Checked ${sheetCount} sheets, ${articleCount} articles: ${findings.length} flagged, ${actionable} need action. Report: ${output}`);
