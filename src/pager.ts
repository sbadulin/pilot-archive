// Рубрика «Пейджер»: разбиение полосы на сообщения и перенос цензуры полосы на их текст.
// Чистые функции; скрипты scripts/pager-*.mjs читают кэш и вызывают их.

export type PagerArticle = {
  title?: string | null;
  rubric?: string | null;
  text?: string | null;
  byline?: string | null;
  box?: number[] | null;
};

// Одно сообщение полосы: article — номер материала в sheet-NN.json, из которого оно взято;
// seq — номер, напечатанный газетой («84. Лучше поздно…»), если он был.
export type PagerPiece = { article: number; seq: number | null; title: string | null; text: string; byline: string | null };

const MARK = /^\s*[■●•▪◆♦]\s*/u;
const NUMBERED = /^\s*(\d{1,3})\.\s+/u;
const NUMBER_TITLE = /^\s*(\d{1,3})\.?\s*$/u;

const paragraphs = (text: string) =>
  text
    .split(/\n\s*\n/)
    .map(part => part.trim())
    .filter(Boolean);

// Склейка: Claude иногда отдаёт колонку пейджера одним материалом — абзацы с маркерами «■»/«●»,
// с номерами «84.» или просто подряд. Объявления редакции («СУПЕР-КОНКУРС!!!», правила купона)
// тоже бывают длинными и с абзацами, но у них есть заголовок и нет сквозной нумерации.
export function isGlued(article: PagerArticle): boolean {
  const text = article.text ?? '';
  const parts = paragraphs(text);
  const numbered = parts.filter(part => NUMBERED.test(part)).length;
  // Каждый абзац — с номером: несколько сообщений, даже короткие («15.»–«20.» в №32 (0201)).
  if (parts.length >= 3 && numbered === parts.length && (!article.title?.trim() || NUMBER_TITLE.test(article.title))) return true;
  if (text.length < 1000 || parts.length < 5) return false;
  // С заголовком режем только сквозную нумерацию («Комсомольск-на-Амуре» над № 106–115):
  // материал «Девочка-тинейджер, позвони на пейджер!!!» с «■»-шутками — одна заметка.
  if (article.title?.trim() && !NUMBER_TITLE.test(article.title)) return numbered * 2 >= parts.length;
  return true;
}

type Style = 'mark' | 'number' | 'plain';
const styleOf = (parts: string[]): Style => {
  if (parts.filter(part => MARK.test(part)).length * 2 >= parts.length) return 'mark';
  if (parts.filter(part => NUMBERED.test(part)).length * 2 >= parts.length) return 'number';
  return 'plain';
};

// Начало нового сообщения или продолжение предыдущего (перенос в следующую колонку,
// стихи с пустой строкой между строфами).
function startsMessage(part: string, previous: string | undefined, style: Style): boolean {
  if (style === 'mark') return MARK.test(part);
  if (style === 'number') return NUMBERED.test(part);
  if (/^[\p{Ll}…,;:–—-]/u.test(part)) return false;
  return !previous || /[.!?…)»"'”]\s*$/u.test(previous);
}

// Материалы полосы → сообщения в порядке чтения. Склеенные материалы режутся по абзацам;
// абзац-продолжение в начале колонки приклеивается к последнему сообщению предыдущей.
export function splitArticles(articles: PagerArticle[]): PagerPiece[] {
  const pieces: PagerPiece[] = [];
  articles.forEach((article, index) => {
    const text = (article.text ?? '').trim();
    if (!text) return;
    const titleNumber = NUMBER_TITLE.exec(article.title ?? '');
    const title = titleNumber ? null : article.title?.trim() || null;
    const byline = article.byline?.trim() || null;
    // Материал без номера и заголовка после незаконченного нумерованного сообщения — его хвост
    // из следующей колонки («…Привет для» | «Кисы в г. Иркутск! …» КиМ в №32 (0201)). Материалы
    // редакции с заголовком между ними (бланк купона внизу колонки) перешагиваются.
    let at = pieces.length - 1;
    while (at >= 0 && pieces[at].title && pieces[at].seq === null && !NUMBERED.test(pieces[at].text)) at -= 1;
    const last = pieces[at];
    // Подписанное сообщение закончено: «Ветер, перестань дуть!…» после «251. … М-202» — отдельное.
    const numberedLast = last && !last.byline && (last.seq !== null || NUMBERED.test(last.text));
    if (numberedLast && !title && !titleNumber && !NUMBERED.test(text) && !/[.!?…)»"'”]\s*$/u.test(last.text)) {
      last.text = `${last.text} ${text}`;
      last.byline ??= byline;
      return;
    }
    if (!isGlued(article)) {
      pieces.push({ article: index, seq: titleNumber ? Number(titleNumber[1]) : null, title, text, byline });
      return;
    }
    const parts = paragraphs(text);
    const style = styleOf(parts);
    let own = 0;
    parts.forEach((part, i) => {
      const last = pieces[pieces.length - 1];
      if (last && !startsMessage(part, i ? parts[i - 1] : undefined, style)) {
        // Первый абзац колонки без маркера — хвост сообщения из предыдущей колонки.
        last.text = `${last.text}${i === 0 ? ' ' : '\n\n'}${part}`;
        return;
      }
      const number = NUMBERED.exec(part);
      const body = part.replace(MARK, '').replace(style === 'number' ? NUMBERED : /^$/u, '');
      pieces.push({ article: index, seq: style === 'number' && number ? Number(number[1]) : null, title: own === 0 ? title : null, text: body, byline: null });
      own += 1;
    });
    // Подпись материала относится к его последнему сообщению.
    if (byline && own) pieces[pieces.length - 1].byline = byline;
  });
  return pieces;
}

// Пейджер номера бывает разнесён по полосам, и сообщение рвётся на стыке посреди слова
// (№32 (0201): «…подойти слишком близ-» в конце полосы 10, «ко!» ПТ.» в начале полосы 23).
// Первое сообщение полосы со строчной буквы, когда последнее сообщение предыдущей полосы того же
// номера не закончено, — его хвост: приклеивается к нему, перенос слова снимается.
// Клеятся уже закрытые тексты (pager-public.mjs, после цензуры): каждый кусок закрыт решениями
// своей полосы, а hold любого из них держит всё сообщение.
type SeamMessage = { year: number; number: string; serial: string; sheet: number; text: string; from: string | null; to: string[]; byline: string | null; hold?: boolean; redactions?: unknown[] };
export function joinSheetSeams<T extends SeamMessage>(messages: T[]): T[] {
  const joined: T[] = [];
  for (const message of messages) {
    const last = joined[joined.length - 1];
    const seam = last && last.serial === message.serial && last.year === message.year && last.sheet !== message.sheet;
    if (seam && /^[\p{Ll}…,;:–—]/u.test(message.text.trim()) && !/[.!?…)»"'”]\s*$/u.test(last.text)) {
      const head = last.text.trimEnd();
      const tail = message.text.trimStart();
      last.text = /\p{L}-$/u.test(head) ? `${head.slice(0, -1)}${tail}` : `${head} ${tail}`;
      last.from ??= message.from;
      last.byline ??= message.byline;
      last.to = [...new Set([...last.to, ...message.to])];
      if (message.hold) last.hold = true;
      if (message.redactions?.length) last.redactions = [...(last.redactions ?? []), ...message.redactions];
      continue;
    }
    joined.push(message);
  }
  return joined;
}

export const messageId = (issue: { year: number; number: string; serial: string }, sheet: number, n: number) =>
  `${issue.year}-${issue.number}-${issue.serial}-p${sheet}-${n}`;

// ---------- Слова tesseract ----------

export type Word = { block: string; left: number; top: number; right: number; bottom: number; raw: string };
export type Page = { width: number; height: number; words: Word[] };

export function parseWords(tsv: string): Page {
  let width = 0;
  let height = 0;
  const words: Word[] = [];
  for (const line of tsv.split('\n').slice(1)) {
    const cols = line.split('\t');
    if (cols[0] === '1') {
      width = Number(cols[8]);
      height = Number(cols[9]);
    }
    if (cols[0] !== '5' || !cols[11]?.trim()) continue;
    const left = Number(cols[6]);
    const top = Number(cols[7]);
    words.push({ block: `${cols[1]}.${cols[2]}`, left, top, right: left + Number(cols[8]), bottom: top + Number(cols[9]), raw: cols[11].trim() });
  }
  return { width, height, words };
}

export type Rect = { left: number; top: number; right: number; bottom: number };
export const percentRect = (page: Page, [left, top, right, bottom]: number[]): Rect => ({
  left: (left * page.width) / 100,
  top: (top * page.height) / 100,
  right: (right * page.width) / 100,
  bottom: (bottom * page.height) / 100,
});

const overlap = (a: Rect, b: Rect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

// Слова под явной плашкой (box): задетые хотя бы на треть площади — плашка часто режет край слова.
export const wordsUnderBox = (page: Page, box: Rect) =>
  page.words.map((word, index) => ({ word, index })).filter(({ word }) => {
    const area = (word.right - word.left) * (word.bottom - word.top);
    return area > 0 && overlap(word, box) >= area / 3;
  }).map(({ index }) => index);

// Слова области (region): центр внутри, как в redact-issue.mjs.
export const wordsInRegion = (page: Page, area: Rect) =>
  page.words.map((word, index) => ({ word, index })).filter(({ word }) => {
    const x = (word.left + word.right) / 2;
    const y = (word.top + word.bottom) / 2;
    return x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;
  }).map(({ index }) => index);

// ---------- Токены и нечёткое сравнение ----------

const LATIN: Record<string, string> = { a: 'а', c: 'с', e: 'е', o: 'о', p: 'р', x: 'х', y: 'у', k: 'к', m: 'м', h: 'н', t: 'т', b: 'в' };
export const normToken = (token: string) =>
  token.toLowerCase().replace(/ё/g, 'е').replace(/[acepoxykmhtb]/g, ch => LATIN[ch]);

export type Token = { norm: string; start: number; end: number };
const TOKEN = /[\p{L}\p{N}]+(?:[-'’@][\p{L}\p{N}]+)*/gu;
export function tokenize(text: string): Token[] {
  return [...text.matchAll(TOKEN)].map(found => ({ norm: normToken(found[0]), start: found.index, end: found.index + found[0].length }));
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = next;
    }
  }
  return row[b.length];
}

// Похожесть слова tesseract на слово текста, 0…1. Числа — только точно (номер дома или
// телефона, отличающийся цифрой, — другой); половина слова, перенесённая на другую строку,
// засчитывается за совпадение, если это хотя бы половина слова (не «про» в «пропутинскими»).
// Короткие слова — не больше одной ошибки («Пушку» — не «пятку»).
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  // Цифры сравниваются без дефисов: tesseract склеивает «6-42-» / «90» в «6-4290».
  if (/\d/.test(a) || /\d/.test(b)) return a.replace(/\D/g, '') === b.replace(/\D/g, '') && /^[\d-]+$/.test(a) && /^[\d-]+$/.test(b) ? 1 : 0;
  const sim = 1 - levenshtein(a, b) / Math.max(a.length, b.length);
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4 && short.length * 2 >= long.length && (long.startsWith(short) || long.endsWith(short))) return Math.max(sim, 0.8);
  if (long.length <= 5 && sim < 0.75) return 0;
  return sim;
}

export type QueryToken = { norm: string; covered: boolean };
export type Alignment = { score: number; covered: number; matched: number; first: number; last: number };

// Локальное выравнивание (Смит — Уотерман) слов tesseract с контекстом на текст сообщения.
// Возвращает оценку и диапазон токенов сообщения, совпавших с закрытыми словами.
export function align(query: QueryToken[], target: Token[]): Alignment | null {
  const GAP = -0.6;
  const n = query.length;
  const m = target.length;
  if (!n || !m) return null;
  const score = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  const sims = Array.from({ length: n }, (_, i) => target.map(token => similarity(query[i].norm, token.norm)));
  let best = 0;
  let bestAt: [number, number] = [0, 0];
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      const sim = sims[i - 1][j - 1];
      const weight = query[i - 1].covered ? 1.5 : 1;
      const value = Math.max(0, score[i - 1][j - 1] + (sim >= 0.6 ? sim * 2 * weight - 1 : -1), score[i - 1][j] + GAP, score[i][j - 1] + GAP);
      score[i][j] = value;
      if (value > best) {
        best = value;
        bestAt = [i, j];
      }
    }
  }
  if (best <= 0) return null;
  // Обратный проход: какие токены сообщения сопоставлены закрытым словам.
  let [i, j] = bestAt;
  let first = -1;
  let last = -1;
  let matched = 0;
  while (i > 0 && j > 0 && score[i][j] > 0) {
    const sim = sims[i - 1][j - 1];
    const weight = query[i - 1].covered ? 1.5 : 1;
    if (Math.abs(score[i][j] - (score[i - 1][j - 1] + (sim >= 0.6 ? sim * 2 * weight - 1 : -1))) < 1e-9) {
      if (query[i - 1].covered && sim >= 0.6) {
        matched += 1;
        if (last < 0) last = j - 1;
        first = j - 1;
      }
      i -= 1;
      j -= 1;
    } else if (Math.abs(score[i][j] - (score[i - 1][j] + GAP)) < 1e-9) i -= 1;
    else j -= 1;
  }
  const covered = query.filter(token => token.covered).length;
  if (first < 0) return null;
  return { score: best, covered, matched, first, last };
}

// Совпадение принято, если найдена доля ratio закрытых слов (не меньше одного): для плашки,
// где tesseract мог прочитать слова криво, хватает половины.
export const accepted = (found: Alignment | null, ratio = 0.5): found is Alignment =>
  !!found && found.matched >= Math.max(1, Math.ceil(found.covered * ratio));

// Все непересекающиеся вхождения: лучшее, затем рекурсивно слева и справа от него.
// Для find и для подписи/адресатов — закрыть каждое, а не только лучшее. Порог строже, чем у
// одиночного поиска: «не хочу» — не вхождение «не хочу жить».
export const STRICT = 0.75;
export function alignAll(query: QueryToken[], target: Token[], ratio = STRICT, offset = 0): Alignment[] {
  const found = align(query, target);
  if (!accepted(found, ratio)) return [];
  const shifted = { ...found, first: found.first + offset, last: found.last + offset };
  return [
    ...alignAll(query, target.slice(0, found.first), ratio, offset),
    shifted,
    ...alignAll(query, target.slice(found.last + 1), ratio, offset + found.last + 1),
  ];
}

// Кусок «от… до…» (решение from/to или область region) в сообщениях полосы, идущих подряд:
// начало — лучшее совпадение start, конец — первое совпадение end после него в том же или
// одном из следующих maxPieces − 1 сообщений. Не нашлось начала или конца — null: тогда
// вызывающий закрывает всё целиком и отправляет на проверку, а не закрывает половину.
export type RangeHit = { first: { piece: number; token: number }; last: { piece: number; token: number } };
export function locateRange(start: QueryToken[], end: QueryToken[], pieces: Token[][], maxPieces = 4): RangeHit | null {
  let best: { piece: number; found: Alignment } | null = null;
  pieces.forEach((tokens, piece) => {
    const found = align(start, tokens);
    if (accepted(found) && (!best || found.score > best.found.score)) best = { piece, found };
  });
  if (!best) return null;
  const { piece: from, found: head } = best as { piece: number; found: Alignment };
  for (let piece = from; piece < Math.min(pieces.length, from + maxPieces); piece += 1) {
    const offset = piece === from ? head.first : 0;
    const tail = align(end, pieces[piece].slice(offset));
    if (accepted(tail)) return { first: { piece: from, token: head.first }, last: { piece, token: offset + tail.last } };
  }
  return null;
}

// Закрытые куски по сообщениям для найденного диапазона: от начала до конца сообщения,
// промежуточные сообщения целиком, у последнего — с начала.
export function rangeSpans(range: RangeHit, pieces: Token[][], lengths: number[]): Map<number, Span> {
  const spans = new Map<number, Span>();
  for (let piece = range.first.piece; piece <= range.last.piece; piece += 1) {
    const start = piece === range.first.piece ? pieces[piece][range.first.token].start : 0;
    const end = piece === range.last.piece ? pieces[piece][range.last.token].end : lengths[piece];
    spans.set(piece, { start, end });
  }
  return spans;
}

// Слова tesseract → токены запроса. Перенос «То-» / «питься» склеивается в одно слово, закрытое,
// если закрыта любая его часть. Контекст — до `context` незакрытых слов того же блока по бокам.
export function queryFromWords(words: Word[], covered: Set<number>, context = 4): QueryToken[] {
  if (!covered.size) return [];
  const indexes = [...covered].sort((a, b) => a - b);
  const block = words[indexes[0]].block;
  const from = Math.max(0, indexes[0] - context * 2);
  const to = Math.min(words.length - 1, indexes[indexes.length - 1] + context * 2);
  type Merged = { norm: string; covered: boolean; index: number };
  const merged: Merged[] = [];
  for (let index = from; index <= to; index += 1) {
    if (words[index].block !== block && !covered.has(index)) continue;
    for (const [k, token] of tokenize(words[index].raw).entries()) {
      const previous = merged[merged.length - 1];
      if (k === 0 && previous && previous.index === index - 1 && /-$/.test(words[index - 1].raw)) {
        // У чисел дефис настоящий («14-» / «9.» — дом и квартира 14-9), у слов — перенос.
        previous.norm += /\d$/.test(previous.norm) && /^\d/.test(token.norm) ? `-${token.norm}` : token.norm;
        previous.covered ||= covered.has(index);
        previous.index = index;
        continue;
      }
      merged.push({ norm: token.norm, covered: covered.has(index), index });
    }
  }
  const firstCovered = merged.findIndex(token => token.covered);
  const lastCovered = merged.length - 1 - [...merged].reverse().findIndex(token => token.covered);
  return merged.slice(Math.max(0, firstCovered - context), lastCovered + context + 1).map(({ norm, covered: c }) => ({ norm, covered: c }));
}

export const queryFromPhrase = (phrase: string): QueryToken[] => tokenize(phrase).map(token => ({ norm: token.norm, covered: true }));

// ---------- Закрытие фрагментов ----------

export const MARKER = '█████';
export type Span = { start: number; end: number };

// Слитые фрагменты; соседние, между которыми только пробелы и знаки, — одним маркером.
export function mergeSpans(text: string, spans: Span[]): Span[] {
  const sorted = [...spans].filter(span => span.end > span.start).sort((a, b) => a.start - b.start);
  const out: Span[] = [];
  for (const span of sorted) {
    const last = out[out.length - 1];
    if (last && (span.start <= last.end || !/[\p{L}\p{N}]/u.test(text.slice(last.end, span.start)))) last.end = Math.max(last.end, span.end);
    else out.push({ ...span });
  }
  return out;
}

export function applySpans(text: string, spans: Span[]): string {
  let out = '';
  let at = 0;
  for (const span of mergeSpans(text, spans)) {
    out += text.slice(at, span.start) + MARKER;
    at = span.end;
  }
  return out + text.slice(at);
}

// Основа слова сканера («трансвестит») внутри текста: каждое слово целиком.
export function stemSpans(text: string, stem: string, whole = false): Span[] {
  const target = normToken(stem);
  return tokenize(text)
    .filter(token => (whole ? token.norm === target : token.norm.startsWith(target)))
    .map(({ start, end }) => ({ start, end }));
}

// Общее правило по фамилии («Путин»): с заглавной буквы, вместе с именем или инициалами рядом.
export function nameSpans(text: string, name: string): Span[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(
    `(?:(?:Владимир\\p{L}*|В\\.\\s*(?:В\\.)?)\\s*)?(?<![\\p{L}])${escaped}\\p{L}*(?:\\s+(?:В\\.\\s*В\\.|Владимир\\p{L}*(?:\\s+Владимирович\\p{L}*)?))?`,
    'gu',
  );
  return [...text.matchAll(pattern)].map(found => ({ start: found.index, end: found.index + found[0].length }));
}

// Подпись и адресаты тоже публичны: слово, закрытое в тексте, закрывается и в них — и похожее
// написание тоже («Нерусь» в тексте, «Hерусь» в подписи): при сомнении закрываем.
export function alsoSpans(value: string, closedWords: Set<string>): Span[] {
  const closed = [...closedWords];
  return tokenize(value)
    .filter(token => closedWords.has(token.norm) || (token.norm.length >= 3 && closed.some(word => similarity(word, token.norm) >= 0.8)))
    .map(({ start, end }) => ({ start, end }));
}

export function censorAlso(value: string, closedWords: Set<string>, extra: Span[] = []): string {
  const spans = [...alsoSpans(value, closedWords), ...extra];
  return spans.length ? applySpans(value, spans) : value;
}

export const closedWordsOf = (text: string, spans: Span[]) =>
  new Set(
    tokenize(text)
      .filter(token => spans.some(span => token.start >= span.start && token.end <= span.end))
      .map(token => token.norm)
      .filter(norm => norm.length >= 3 || /\d/.test(norm)),
  );
