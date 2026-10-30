// Публичный текст «Пейджера»: всё, что закрыто плашками в публичных PDF, закрыто и в тексте.
//
//   npm run pager:public -- [--cache <dir>]
//
// Берёт pager-index.json (pager-index.mjs) и решения цензуры каждого выпуска (redactions.json
// плюс общие правила scripts/redaction-rules.json) и переносит одобренные решения с полос на
// сообщения:
//   find          — каждое вхождение фразы во всех сообщениях полосы (нечётко: Claude и
//                   tesseract читают по-разному), в тексте, подписи и адресатах;
//   from/to       — от первых слов до последних, в том числе через несколько сообщений;
//   box           — слова tesseract под плашкой (words-NN.tsv) вместе с соседними ищутся в
//                   тексте сообщений, закрываются совпавшие с закрытыми;
//   region        — от первой до последней строки области (начало и конец ищутся отдельно);
//   stem, article — слова с основой / материал целиком;
//   name          — фамилия с именем и инициалами, кроме материалов из exceptIn.
// Закрытый кусок заменяется на «█████» (MARKER).
//
// Цензура fail-closed: при сомнении закрываем или отправляем на проверку, но молча не открываем.
//   - выпуск без redactions.json в публичный файл не попадает (unreviewedIssues в review);
//   - решение, не найденное ни в сообщениях, ни в других материалах полосы, — в review, а
//     сообщения этой полосы получают hold: true (не публиковать до проверки);
//   - find нашёлся в тексте реже, чем tesseract на полосе, — в review и hold;
//   - область, у которой не нашлось начало или конец, закрывается в задетых сообщениях
//     целиком и попадает в review;
//   - слово, закрытое в тексте, закрывается и в подписи и адресатах (похожее написание тоже);
//     подпись, которая целиком лежит в закрытом куске текста, но осталась открытой, — в review.
// Потом по публичному тексту проходит сканер (src/riskTerms.ts): его находки, которых нет в
// решениях выпуска, не закрываются, а попадают на проверку.
// Пишет в корень кэша pager-public.json, pager-review.json и pager-review.md. Все три файла
// содержат тексты читателей: в Git их не класть.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import {
  align,
  alignAll,
  accepted,
  applySpans,
  censorAlso,
  closedWordsOf,
  joinSheetSeams,
  locateRange,
  nameSpans,
  normToken,
  parseWords,
  percentRect,
  queryFromPhrase,
  queryFromWords,
  rangeSpans,
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
// Сколько закрытых слов области берётся якорем начала и конца.
const ANCHOR = 5;

const index = JSON.parse(await readFile(join(cacheRoot, 'pager-index.json'), 'utf8'));
const byIssue = new Map();
for (const message of index) {
  const issue = `${message.year}-${message.number}-${message.serial}`;
  if (!byIssue.has(issue)) byIssue.set(issue, []);
  byIssue.get(issue).push(message);
}

const center = rect => [(rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2];
const inside = ([x, y], box, margin = 3) => !!box && x >= box[0] - margin && x <= box[2] + margin && y >= box[1] - margin && y <= box[3] + margin;
const intersects = (a, b) => !!a && !!b && a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
const compact = text => normToken(text ?? '').replace(/[^\p{L}\p{N}]/gu, '');

const review = [];
const unreviewedIssues = [];
const hits = [];
const stats = { decisions: 0, located: 0, otherArticles: 0, ambiguous: 0 };
const publicIndex = [];

for (const [issue, messages] of byIssue) {
  const dir = join(cacheRoot, issue);
  let spec;
  try {
    spec = JSON.parse(await readFile(join(dir, 'redactions.json'), 'utf8'));
    if (!Array.isArray(spec.items)) throw new Error('no items');
  } catch (error) {
    // Выпуск без решений не проверен: его сообщения не публикуются.
    unreviewedIssues.push({ issue, messages: messages.length, error: error.message });
    continue;
  }
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
      sheets.set(sheet, { data, words: async () => (page ??= parseWords(await readFile(join(dir, `words-${pad(sheet)}.tsv`), 'utf8'))) });
    }
    return sheets.get(sheet);
  };
  const states = messages.map(message => ({
    message,
    spans: Object.fromEntries(FIELDS.map(field => [field, []])),
    fromSpans: [],
    toSpans: (message.to ?? []).map(() => []),
    reasons: [],
    hold: false,
    tokens: Object.fromEntries(FIELDS.map(field => [field, tokenize(message[field] ?? '')])),
  }));
  const note = (state, item, kind) => {
    const reason = { kind, ...(item.id ? { decision: item.id } : {}), ...(item.reason ? { reason: item.reason } : {}) };
    if (!state.reasons.some(other => other.kind === reason.kind && other.decision === reason.decision && other.reason === reason.reason)) state.reasons.push(reason);
  };
  const close = (state, field, span, item, kind) => {
    state.spans[field].push(span);
    note(state, item, kind);
  };
  const closeWhole = (state, item, kind) => {
    for (const field of FIELDS) if (state.message[field]) close(state, field, { start: 0, end: state.message[field].length }, item, kind);
    if (state.message.from) state.fromSpans.push({ start: 0, end: state.message.from.length });
  };
  // Подпись и адресаты: та же фраза или те же слова закрываются и там (нечётко, каждое вхождение).
  const closeInSignature = (state, query, item, kind) => {
    const apply = (value, list) => {
      const tokens = tokenize(value ?? '');
      for (const found of alignAll(query, tokens)) list.push({ start: tokens[found.first].start, end: tokens[found.last].end });
    };
    const before = state.fromSpans.length + state.toSpans.flat().length;
    apply(state.message.from, state.fromSpans);
    (state.message.to ?? []).forEach((name, i) => apply(name, state.toSpans[i]));
    const added = state.fromSpans.length + state.toSpans.flat().length - before;
    if (added) note(state, item, kind);
    return added;
  };
  const sheetStates = sheet => states.filter(state => state.message.sheet === sheet);
  const articleBox = (sheet, state) => sheets.get(sheet)?.data.result.articles[state.message.article]?.box;
  const near = (sheet, test) => {
    const own = sheetStates(sheet);
    const found = own.filter(state => test(articleBox(sheet, state)));
    return found.length ? found : own;
  };
  // Решение относится к другому материалу полосы (не к пейджеру), если его место лежит в рамке
  // материала, из которого нет сообщений, или фраза есть только в тексте такого материала.
  const otherArticles = (sheet, data) => {
    const used = new Set(sheetStates(sheet).map(state => state.message.article));
    return data.result.articles.filter((_, i) => !used.has(i));
  };
  const inOtherArticleAt = (sheet, data, point) =>
    !sheetStates(sheet).some(state => inside(point, articleBox(sheet, state), 0.5)) && otherArticles(sheet, data).some(article => inside(point, article.box, 0.5));
  const inOtherArticleText = (sheet, data, query) =>
    otherArticles(sheet, data).some(article => FIELDS.some(field => accepted(align(query, tokenize(article[field] ?? '')))));
  // hold — сообщения, которые нельзя публиковать до проверки (по умолчанию вся полоса).
  const flag = (item, problem, details = {}, hold = sheetStates(item.sheet)) => {
    review.push({ issue, sheet: item.sheet, kind: item.kind, problem, value: item.value, reason: item.reason ?? null, ...details, held: hold.map(state => state.message.id) });
    for (const state of hold) state.hold = true;
  };
  // Цитаты из причины решения («ул.Пирогова, 23», «пр. Интер-национальному … кв. 45»): по ним
  // ищется место плашки, когда tesseract слова под ней не прочитал.
  const quotesOf = reason =>
    [...(reason ?? '').matchAll(/«([^«»]+)»/g)].flatMap(found => found[1].split(/…|\.\.\./)).map(part => part.trim()).filter(part => tokenize(part).length);
  const closeQuotes = (states, item, kind, quotes = quotesOf(item.reason)) => {
    const closedIn = new Set();
    for (const quote of quotes) {
      const query = queryFromPhrase(quote);
      for (const state of states) {
        for (const field of FIELDS) {
          for (const found of alignAll(query, state.tokens[field])) {
            close(state, field, { start: state.tokens[field][found.first].start, end: state.tokens[field][found.last].end }, item, kind);
            closedIn.add(state);
          }
        }
        closeInSignature(state, query, item, kind);
      }
    }
    return [...closedIn];
  };

  const pagerSheets = new Set(messages.map(message => message.sheet));
  for (const raw of spec.items) {
    if (raw.name || !raw.approved || raw.keep || !pagerSheets.has(raw.sheet)) continue;
    const { data, words } = await sheetData(raw.sheet);
    const kind = ['find', 'from', 'stem', 'region', 'box', 'article'].find(key => key in raw);
    const item = { ...raw, kind, value: kind === 'from' ? `${raw.from} … ${raw.to}` : raw[kind] };
    stats.decisions += 1;
    const pool = sheetStates(item.sheet);
    let located = 0;
    let other = false;

    if (kind === 'find') {
      const query = queryFromPhrase(item.find);
      for (const state of pool) {
        for (const field of FIELDS) {
          for (const found of alignAll(query, state.tokens[field])) {
            close(state, field, { start: state.tokens[field][found.first].start, end: state.tokens[field][found.last].end }, item, 'find');
            located += 1;
          }
        }
        located += closeInSignature(state, query, item, 'find');
      }
      if (!located) {
        // Точного вхождения нет — лучшее нечёткое (половина слов): закрываем, но на проверку.
        let best = null;
        for (const state of pool) {
          for (const field of FIELDS) {
            const found = align(query, state.tokens[field]);
            if (accepted(found) && (!best || found.score > best.found.score)) best = { state, field, found };
          }
        }
        if (best) {
          close(best.state, best.field, { start: best.state.tokens[best.field][best.found.first].start, end: best.state.tokens[best.field][best.found.last].end }, item, 'find');
          located = 1;
          flag(item, 'find-fuzzy', { matched: `${best.found.matched}/${best.found.covered}` }, [best.state]);
        }
      }
      if (located) {
        // Сколько раз фраза есть на полосе у tesseract (столько плашек при all).
        const page = await words();
        const onPage = alignAll(query, tokenize(page.words.map(word => word.raw).join(' '))).length;
        const expected = item.all ? onPage : Math.min(1, onPage);
        if (located < expected) flag(item, 'fewer-in-text', { closedInText: located, onPage });
      } else other = inOtherArticleText(item.sheet, data, query);
    } else if (kind === 'from') {
      const range = locateRange(queryFromPhrase(item.from), queryFromPhrase(item.to), pool.map(state => state.tokens.text));
      if (range) {
        for (const [piece, span] of rangeSpans(range, pool.map(state => state.tokens.text), pool.map(state => state.message.text.length))) close(pool[piece], 'text', span, item, 'from-to');
        located = 1;
      } else other = inOtherArticleText(item.sheet, data, queryFromPhrase(item.from));
    } else if (kind === 'stem') {
      const targets = pool.filter(state => !item.within || intersects(item.within, articleBox(item.sheet, state)));
      for (const state of targets) {
        for (const field of FIELDS) {
          for (const span of stemSpans(state.message[field] ?? '', item.stem, item.whole)) {
            close(state, field, span, item, 'stem');
            located += 1;
          }
        }
        for (const span of stemSpans(state.message.from ?? '', item.stem, item.whole)) state.fromSpans.push(span);
        (state.message.to ?? []).forEach((name, i) => state.toSpans[i].push(...stemSpans(name, item.stem, item.whole)));
      }
      if (!located) other = !targets.length;
    } else if (kind === 'article') {
      for (const state of pool) {
        const article = data.result.articles[state.message.article];
        if (!(article?.title ?? '').toLowerCase().includes(item.article.toLowerCase())) continue;
        closeWhole(state, item, 'article');
        located += 1;
      }
      if (!located) other = true;
    } else if (kind === 'box') {
      const page = await words();
      const covered = new Set(wordsUnderBox(page, percentRect(page, item.box)));
      const at = center(item.box);
      if (covered.size) {
        const query = queryFromWords(page.words, covered);
        const candidates = near(item.sheet, box => inside(at, box));
        let best = [];
        for (const state of candidates) {
          for (const field of FIELDS) {
            const found = align(query, state.tokens[field]);
            if (!accepted(found)) continue;
            if (!best.length || found.score > best[0].found.score + 1e-6) best = [{ state, field, found }];
            else if (Math.abs(found.score - best[0].found.score) <= 1e-6) best.push({ state, field, found });
          }
        }
        if (best.length > 1) stats.ambiguous += 1;
        for (const { state, field, found } of best) {
          close(state, field, { start: state.tokens[field][found.first].start, end: state.tokens[field][found.last].end }, item, 'box');
          located += 1;
        }
        // Под плашкой бывает подпись: те же слова закрываются в подписи и адресатах.
        const bare = queryFromWords(page.words, covered, 0).filter(token => token.covered);
        for (const state of candidates) closeInSignature(state, bare, item, 'box');
        if (best.length && best[0].found.matched < best[0].found.covered) {
          item.partial = `${best[0].found.matched}/${best[0].found.covered}`;
          item.closedIn = best.map(hit => hit.state);
        }
      }
      // Слова, которые tesseract под плашкой не прочитал («убей себя!» перед прочитанным «Так всем»):
      // решение перечисляет их в `text`, и они закрываются в сообщениях под плашкой.
      // Рамки материалов у Claude приблизительные, и сообщение под плашкой бывает в соседней рамке
      // (телефон Виктоши в №32 (0201)): тогда явные слова ищутся по всей полосе.
      if (item.text) {
        let byText = closeQuotes(near(item.sheet, box => inside(at, box)), item, 'box', item.text);
        if (!byText.length) byText = closeQuotes(sheetStates(item.sheet), item, 'box', item.text);
        if (byText.length) {
          located ||= byText.length;
          delete item.partial;
        }
      }
      if (!located) {
        // tesseract слова под плашкой не прочитал или прочитал мимо: ищем по цитате из причины.
        const byQuote = closeQuotes(near(item.sheet, box => inside(at, box)), item, 'box');
        if (byQuote.length) {
          located = byQuote.length;
          item.byQuote = byQuote;
        }
      }
      if (!located) other = inOtherArticleAt(item.sheet, data, at);
      item.hold = near(item.sheet, box => inside(at, box));
      item.tesseract = [...covered].map(i => page.words[i].raw).join(' ') || null;
    } else if (kind === 'region') {
      const page = await words();
      const covered = wordsInRegion(page, percentRect(page, item.region));
      const touched = near(item.sheet, box => intersects(item.region, box));
      if (covered.length) {
        const start = queryFromWords(page.words, new Set(covered.slice(0, ANCHOR)));
        const end = queryFromWords(page.words, new Set(covered.slice(-ANCHOR)));
        const range = locateRange(start, end, touched.map(state => state.tokens.text), touched.length);
        if (range) {
          for (const [piece, span] of rangeSpans(range, touched.map(state => state.tokens.text), touched.map(state => state.message.text.length))) close(touched[piece], 'text', span, item, 'region');
          located = 1;
        }
      }
      if (!located && !inOtherArticleAt(item.sheet, data, center(item.region))) {
        // Начало или конец области не нашлись: закрываем задетые сообщения целиком и просим проверить.
        const whole = sheetStates(item.sheet).filter(state => intersects(item.region, articleBox(item.sheet, state)));
        for (const state of whole) closeWhole(state, item, 'region-whole');
        if (whole.length) {
          flag(item, 'region-closed-whole', { closedMessages: whole.map(state => state.message.id) }, []);
          located = whole.length;
        }
      } else if (!located) other = true;
      item.tesseract = covered.length ? `${covered.length} words` : null;
      item.hold = touched;
    }

    if (located) {
      stats.located += 1;
      // Найдено по цитате из причины: закрыто, но место стоит проверить глазами (без hold).
      if (item.byQuote) flag(item, 'box-by-quote', { tesseract: item.tesseract, closed: item.byQuote.map(state => state.message.id) }, []);
      else if (item.partial) flag(item, 'box-partial', { matched: item.partial, tesseract: item.tesseract }, item.closedIn);
    } else if (other) stats.otherArticles += 1;
    else flag(item, 'not-found', item.tesseract !== undefined ? { tesseract: item.tesseract } : {}, item.hold ?? sheetStates(item.sheet));
  }

  // Общие правила по фамилии — в тексте, подписи и адресатах.
  for (const rule of names.filter(rule => rule.approved && !rule.keep)) {
    const except = rule.exceptIn ? new RegExp(rule.exceptIn, 'iu') : null;
    for (const state of states) {
      const { data } = await sheetData(state.message.sheet);
      if (data.result.pageType === 'tv') continue;
      const article = data.result.articles[state.message.article] ?? {};
      if (except?.test(`${article.rubric ?? ''} ${article.title ?? ''}`)) continue;
      for (const field of FIELDS) for (const span of nameSpans(state.message[field] ?? '', rule.name)) close(state, field, span, rule, 'name');
      state.fromSpans.push(...nameSpans(state.message.from ?? '', rule.name));
      (state.message.to ?? []).forEach((name, i) => state.toSpans[i].push(...nameSpans(name, rule.name)));
    }
  }

  for (const state of states) {
    const { message } = state;
    const closed = new Set(FIELDS.flatMap(field => [...closedWordsOf(message[field] ?? '', state.spans[field])]));
    const out = { ...message };
    for (const field of FIELDS) if (message[field]) out[field] = applySpans(message[field], state.spans[field]);
    out.from = message.from ? censorAlso(message.from, closed, state.fromSpans) : null;
    out.to = (message.to ?? []).map((name, i) => censorAlso(name, closed, state.toSpans[i]));
    // Подпись целиком внутри закрытого куска текста, а в from открыта — на проверку.
    const closedText = FIELDS.flatMap(field => state.spans[field].map(span => compact((message[field] ?? '').slice(span.start, span.end))));
    if (message.from && out.from === message.from && compact(message.from).length >= 3 && closedText.some(text => text.includes(compact(message.from)))) {
      review.push({ issue, sheet: message.sheet, kind: 'signature', problem: 'from-untouched', id: message.id, value: message.from });
      state.hold = true;
    }
    out.redactions = state.reasons;
    if (state.hold) out.hold = true;
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

// Хвост сообщения, разорванного между полосами, уходит к его началу — уже закрытым: каждый
// кусок прошёл цензуру своей полосы. id остальных сообщений не меняются. Слово, собранное на
// стыке, цензура не видела целиком: с заглавной (имя, фамилия) или с находкой сканера — hold.
const joined = joinSheetSeams(publicIndex, (message, seam) => {
  const word = seam.text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (!(seam.word && /^\p{Lu}/u.test(word)) && !findRisks(seam.text).length) return;
  message.hold = true;
  review.push({ issue: `${message.year}-${message.number}-${message.serial}`, sheet: message.sheet, kind: 'seam', problem: 'seam-word', id: message.id, value: seam.text });
});
publicIndex.splice(0, publicIndex.length, ...joined);
await writeFile(join(cacheRoot, 'pager-public.json'), JSON.stringify(publicIndex, null, 2));
const redactedMessages = publicIndex.filter(message => message.redactions.length).length;
const held = publicIndex.filter(message => message.hold).length;
const problems = {};
for (const item of review) problems[item.problem] = (problems[item.problem] ?? 0) + 1;
await writeFile(
  join(cacheRoot, 'pager-review.json'),
  JSON.stringify({ generated: new Date().toISOString(), stats: { ...stats, messages: publicIndex.length, redactedMessages, held, problems, hits: hits.length }, unreviewedIssues, review, hits }, null, 2),
);

const problemText = {
  'not-found': 'решение не найдено ни в сообщениях, ни в других материалах полосы',
  'fewer-in-text': 'фраза закрыта в тексте реже, чем встречается на полосе',
  'box-partial': 'под плашкой слова, найденные в тексте не все',
  'box-by-quote': 'слова под плашкой не найдены, место найдено по цитате из причины решения — проверить',
  'find-fuzzy': 'точного вхождения фразы нет, закрыто лучшее нечёткое — проверить',
  'region-closed-whole': 'начало или конец области не найдены — сообщения закрыты целиком',
  'from-untouched': 'подпись лежит в закрытом куске текста, но в from открыта',
  'seam-word': 'сообщение склеено из двух полос, слово на стыке цензура целиком не видела — проверить',
};
const md = [
  '# Пейджер: проверка цензуры',
  '',
  `Сообщений: ${publicIndex.length}, с закрытыми местами: ${redactedMessages}, на удержании (hold — не публиковать до проверки): ${held}. Решений на полосах пейджера: ${stats.decisions}, найдено в тексте: ${stats.located}, относятся к другим материалам полосы: ${stats.otherArticles}, неоднозначных плашек: ${stats.ambiguous}.`,
  '',
  ...(unreviewedIssues.length ? [`## Выпуски без решений цензуры (${unreviewedIssues.length}) — в публичный файл не попали`, '', ...unreviewedIssues.map(item => `- ${item.issue}: ${item.messages} сообщений (${item.error})`), ''] : []),
  `## Решения (${review.length})`,
  '',
  ...review.map(item => `- [${item.problem}] ${item.issue}, полоса ${item.sheet}, ${item.kind}${item.id ? ` \`${item.id}\`` : ''}: \`${JSON.stringify(item.value)}\`${item.tesseract !== undefined ? ` (tesseract: ${item.tesseract ?? 'слов нет'})` : ''}${item.matched ? ` найдено ${item.matched}` : ''}${item.closedInText !== undefined ? ` в тексте ${item.closedInText}, на полосе ${item.onPage}` : ''} — ${problemText[item.problem]}${item.reason ? `. ${item.reason}` : ''}`),
  '',
  `## Находки сканера в публичном тексте (${hits.length})`,
  '',
  'Не закрыты. new — решения нет; pending — решение ждёт куратора; approved-not-closed — решение одобрено, но в тексте не найдено.',
  '',
  ...hits.map(hit => `- \`${hit.id}\` (${hit.date}) ${hit.categoryLabel}${hit.weak ? '?' : ''} «${hit.word}» [${hit.status}]: ${hit.excerpt}`),
  '',
].join('\n');
await writeFile(join(cacheRoot, 'pager-review.md'), md);
console.log(
  `Pager public: ${publicIndex.length} messages, ${redactedMessages} with redactions, ${held} held; decisions ${stats.decisions}, located ${stats.located}, other articles ${stats.otherArticles}, ambiguous ${stats.ambiguous}; review ${JSON.stringify(problems)}; unreviewed issues ${unreviewedIssues.length}; scanner hits ${hits.length} (${hits.filter(hit => hit.status === 'new').length} new) → ${join(cacheRoot, 'pager-public.json')}`,
);
