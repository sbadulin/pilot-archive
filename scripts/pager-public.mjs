// Публичный текст «Пейджера»: всё, что закрыто плашками в публичных PDF, закрыто и в тексте.
//
//   npm run pager:public -- [--cache <dir>]
//
// Берёт pager-index.json (pager-index.mjs) и решения цензуры каждого выпуска (redactions.json
// плюс общие правила scripts/redaction-rules.json) и переносит одобренные решения с полос на
// сообщения:
//   find, from/to — фраза ищется в тексте сообщения нечётко (Claude и tesseract читают по-разному);
//   box, region   — слова tesseract под плашкой (words-NN.tsv) вместе с соседними словами ищутся
//                   в тексте сообщений той же полосы, закрываются совпавшие с закрытыми;
//   stem          — слова с основой в сообщениях из того же материала;
//   name          — фамилия с именем и инициалами, кроме материалов из exceptIn.
// Закрытый кусок заменяется на «█████» (MARKER); слово, закрытое в тексте, закрывается и
// в подписи и адресатах. Потом по публичному тексту проходит сканер (src/riskTerms.ts): его
// находки, которых нет в решениях выпуска, не закрываются, а попадают на проверку.
// Пишет в корень кэша pager-public.json, pager-review.json и pager-review.md. Все три файла
// содержат тексты читателей: в Git их не класть.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  accepted,
  align,
  applySpans,
  censorAlso,
  closedWordsOf,
  nameSpans,
  parseWords,
  percentRect,
  queryFromPhrase,
  queryFromWords,
  stemSpans,
  tokenize,
  wordsInRegion,
  wordsUnderBox,
} from '../src/pager.ts';
import { findRisks, riskCategoryLabels } from '../src/riskTerms.ts';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const cacheRoot = option('cache', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache'));
const rules = JSON.parse(await readFile(new URL('./redaction-rules.json', import.meta.url), 'utf8'));
const pad = n => String(n).padStart(2, '0');
const FIELDS = ['title', 'text', 'byline'];

const index = JSON.parse(await readFile(join(cacheRoot, 'pager-index.json'), 'utf8'));
const byIssue = new Map();
for (const message of index) {
  const issue = `${message.year}-${message.number}-${message.serial}`;
  if (!byIssue.has(issue)) byIssue.set(issue, []);
  byIssue.get(issue).push(message);
}

const center = rect => [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2];
const inside = ([x, y], box, pad = 3) => box && x >= box[0] - pad && x <= box[2] + pad && y >= box[1] - pad && y <= box[3] + pad;
const intersects = (a, b) => a && b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

const unmatched = [];
const hits = [];
const stats = { decisions: 0, located: 0, ambiguous: 0, otherArticles: 0 };
const publicIndex = [];

for (const [issue, messages] of byIssue) {
  const dir = join(cacheRoot, issue);
  const spec = JSON.parse(await readFile(join(dir, 'redactions.json'), 'utf8').catch(() => '{"items":[]}'));
  const names = [...rules.names.map(rule => ({ ...rule, approved: true }))];
  for (const item of spec.items.filter(item => item.name)) {
    const own = names.find(rule => rule.name === item.name);
    if (own) Object.assign(own, { approved: !item.keep, exceptIn: item.exceptIn ?? own.exceptIn });
    else if (item.approved) names.push(item);
  }
  const sheets = new Map();
  const sheetData = async sheet => {
    if (!sheets.has(sheet)) {
      const data = JSON.parse(await readFile(join(dir, `sheet-${pad(sheet)}.json`), 'utf8'));
      let page = null;
      sheets.set(sheet, {
        data,
        words: async () => (page ??= parseWords(await readFile(join(dir, `words-${pad(sheet)}.tsv`), 'utf8'))),
      });
    }
    return sheets.get(sheet);
  };
  // Состояние сообщения: исходные поля, найденные куски и причины.
  const states = messages.map(message => ({
    message,
    spans: Object.fromEntries(FIELDS.map(field => [field, []])),
    reasons: [],
    tokens: Object.fromEntries(FIELDS.map(field => [field, tokenize(message[field] ?? '')])),
  }));
  const close = (state, field, span, item, kind) => {
    state.spans[field].push(span);
    const reason = { kind, ...(item.id ? { decision: item.id } : {}), ...(item.reason ? { reason: item.reason } : {}) };
    if (!state.reasons.some(other => other.kind === reason.kind && other.decision === reason.decision && other.reason === reason.reason)) state.reasons.push(reason);
  };
  const candidates = (sheet, at) => {
    const own = states.filter(state => state.message.sheet === sheet);
    if (!at) return own;
    const near = own.filter(state => inside(at, sheets.get(sheet)?.data.result.articles[state.message.article]?.box));
    return near.length ? near : own;
  };
  // Лучшее выравнивание запроса по полям сообщений; равные по оценке закрываются все.
  const locate = (query, pool) => {
    let best = [];
    for (const state of pool) {
      for (const field of FIELDS) {
        const found = align(query, state.tokens[field]);
        if (!accepted(found)) continue;
        const hit = { state, field, found };
        if (!best.length || found.score > best[0].found.score + 1e-6) best = [hit];
        else if (Math.abs(found.score - best[0].found.score) <= 1e-6) best.push(hit);
      }
    }
    return best;
  };
  const spanOf = (hit, last = hit.found.last) => ({ start: hit.state.tokens[hit.field][hit.found.first].start, end: hit.state.tokens[hit.field][last].end });

  const pagerSheets = new Set(messages.map(message => message.sheet));
  for (const item of spec.items) {
    if (item.name || !item.approved || item.keep || !pagerSheets.has(item.sheet)) continue;
    const { data, words } = await sheetData(item.sheet);
    const isPagerPage = data.result.pageType === 'pager';
    const kind = ['find', 'from', 'stem', 'region', 'box', 'article'].find(key => key in item);
    stats.decisions += 1;
    let located = 0;
    if (kind === 'find') {
      const found = locate(queryFromPhrase(item.find), candidates(item.sheet));
      for (const hit of found) close(hit.state, hit.field, spanOf(hit), item, 'find');
      located = found.length;
      if (found.length > 1) stats.ambiguous += 1;
    } else if (kind === 'from') {
      const pool = candidates(item.sheet);
      const start = locate(queryFromPhrase(item.from), pool)[0];
      if (start) {
        const order = pool.indexOf(start.state);
        // Конец ищется в том же сообщении после начала или в одном из трёх следующих.
        for (const state of pool.slice(order, order + 4)) {
          const tokens = state.tokens[start.field];
          const offset = state === start.state ? start.found.first : 0;
          const end = align(queryFromPhrase(item.to), tokens.slice(offset));
          if (!accepted(end)) continue;
          const endAt = tokens[offset + end.last].end;
          if (state === start.state) close(state, start.field, { start: tokens[start.found.first].start, end: endAt }, item, 'from-to');
          else {
            close(start.state, start.field, { start: start.state.tokens[start.field][start.found.first].start, end: (start.state.message[start.field] ?? '').length }, item, 'from-to');
            for (const middle of pool.slice(order + 1, pool.indexOf(state))) close(middle, 'text', { start: 0, end: middle.message.text.length }, item, 'from-to');
            close(state, start.field, { start: 0, end: endAt }, item, 'from-to');
          }
          located = 1;
          break;
        }
      }
    } else if (kind === 'stem') {
      for (const state of candidates(item.sheet)) {
        if (item.within && !intersects(item.within, data.result.articles[state.message.article]?.box)) continue;
        for (const field of FIELDS) {
          for (const span of stemSpans(state.message[field] ?? '', item.stem, item.whole)) {
            close(state, field, span, item, 'stem');
            located += 1;
          }
        }
      }
    } else if (kind === 'article') {
      for (const state of candidates(item.sheet)) {
        const article = data.result.articles[state.message.article];
        if (!(article?.title ?? '').toLowerCase().includes(item.article.toLowerCase())) continue;
        for (const field of FIELDS) if (state.message[field]) close(state, field, { start: 0, end: state.message[field].length }, item, 'article');
        located += 1;
      }
    } else if (kind === 'box' || kind === 'region') {
      const page = await words();
      const rect = percentRect(page, item[kind]);
      const covered = new Set(kind === 'box' ? wordsUnderBox(page, rect) : wordsInRegion(page, rect));
      if (covered.size) {
        const found = locate(queryFromWords(page.words, covered), candidates(item.sheet, center(item[kind])));
        for (const hit of found) close(hit.state, hit.field, spanOf(hit), item, kind);
        located = found.length;
        if (found.length > 1) stats.ambiguous += 1;
      }
      item.coveredWords = [...covered].map(i => page.words[i].raw).join(' ');
    }
    if (located) stats.located += 1;
    else if (!isPagerPage) stats.otherArticles += 1;
    else {
      unmatched.push({
        issue,
        sheet: item.sheet,
        kind,
        value: kind === 'from' ? `${item.from} … ${item.to}` : kind === 'box' || kind === 'region' ? item[kind] : item[kind],
        ...(item.coveredWords !== undefined ? { tesseract: item.coveredWords || null } : {}),
        reason: item.reason ?? null,
      });
    }
  }
  // Общие правила по фамилии.
  for (const rule of names.filter(rule => rule.approved && !rule.keep)) {
    const except = rule.exceptIn ? new RegExp(rule.exceptIn, 'iu') : null;
    for (const state of states) {
      const { data } = await sheetData(state.message.sheet);
      if (data.result.pageType === 'tv') continue;
      const article = data.result.articles[state.message.article] ?? {};
      if (except?.test(`${article.rubric ?? ''} ${article.title ?? ''}`)) continue;
      for (const field of FIELDS) for (const span of nameSpans(state.message[field] ?? '', rule.name)) close(state, field, span, rule, 'name');
    }
  }

  for (const state of states) {
    const { message } = state;
    const closed = new Set(FIELDS.flatMap(field => [...closedWordsOf(message[field] ?? '', state.spans[field])]));
    const out = { ...message };
    for (const field of FIELDS) if (message[field]) out[field] = applySpans(message[field], state.spans[field]);
    out.from = message.from ? censorAlso(message.from, closed) : null;
    out.to = (message.to ?? []).map(name => censorAlso(name, closed));
    out.redactions = state.reasons;
    publicIndex.push(out);

    // Сканер по уже закрытому тексту: всё, что он находит, в PDF не закрыто.
    const { data } = await sheetData(message.sheet);
    const box = data.result.articles[message.article]?.box;
    const text = [out.title, out.text, out.byline, out.from, ...out.to].filter(Boolean).join('\n');
    for (const match of findRisks(text)) {
      const stem = match.term.replace(/=$/, '');
      const decision = spec.items.find(item =>
        item.sheet === message.sheet &&
        ((item.stem && item.stem === stem && (!item.within || !box || intersects(item.within, box))) || (item.find && item.find.toLowerCase().includes(match.word.toLowerCase()))));
      if (decision?.keep) continue;
      hits.push({
        id: message.id,
        date: message.date,
        category: match.category,
        categoryLabel: riskCategoryLabels[match.category],
        term: match.term,
        weak: match.weak,
        word: match.word,
        excerpt: match.excerpt,
        status: !decision ? 'new' : decision.approved ? 'approved-not-closed' : 'pending',
      });
    }
  }
}

await writeFile(join(cacheRoot, 'pager-public.json'), JSON.stringify(publicIndex, null, 2));
const redactedMessages = publicIndex.filter(message => message.redactions.length).length;
const review = { generated: new Date().toISOString(), stats: { ...stats, messages: publicIndex.length, redactedMessages, unmatched: unmatched.length, hits: hits.length }, unmatched, hits };
await writeFile(join(cacheRoot, 'pager-review.json'), JSON.stringify(review, null, 2));

const md = [
  '# Пейджер: проверка цензуры',
  '',
  `Сообщений: ${publicIndex.length}, с закрытыми местами: ${redactedMessages}. Решений на полосах пейджера: ${stats.decisions}, найдено в тексте: ${stats.located}, неоднозначных (закрыто в нескольких сообщениях): ${stats.ambiguous}, относятся к другим материалам полосы: ${stats.otherArticles}.`,
  '',
  `## Решения, не найденные в тексте сообщений (${unmatched.length})`,
  '',
  'Закрыто в PDF, но в тексте не найдено: закрыть вручную или поправить решение.',
  '',
  ...unmatched.map(item => `- ${item.issue}, полоса ${item.sheet}, ${item.kind}: \`${JSON.stringify(item.value)}\`${item.tesseract !== undefined ? ` (tesseract: ${item.tesseract ?? 'слов нет'})` : ''} — ${item.reason ?? ''}`),
  '',
  `## Находки сканера в публичном тексте (${hits.length})`,
  '',
  'Не закрыты. new — решения нет; pending — решение ждёт куратора; approved-not-closed — решение одобрено, но в тексте не найдено.',
  '',
  ...hits.map(hit => `- \`${hit.id}\` (${hit.date}) ${hit.categoryLabel}${hit.weak ? '?' : ''} «${hit.word}» [${hit.status}]: ${hit.excerpt}`),
  '',
].join('\n');
await writeFile(join(cacheRoot, 'pager-review.md'), md);
console.log(`Pager public: ${publicIndex.length} messages, ${redactedMessages} with redactions; decisions ${stats.decisions}, located ${stats.located}, unmatched ${unmatched.length}, ambiguous ${stats.ambiguous}, other articles ${stats.otherArticles}; scanner hits ${hits.length} (${hits.filter(hit => hit.status === 'new').length} new) → ${join(cacheRoot, 'pager-public.json')}`);
