// Bylines of a staged issue taken from the local full-text recognition (scripts/ocr-issue.mjs),
// so «Одобрить» does not send every page to the model a second time (scripts/local-credits.mjs).
import type { SheetResult } from './authorNames';

export type OcrArticle = { kind?: string; rubric?: string | null; title?: string | null; byline?: string | null; text?: string };
export type OcrSheet = { pageType?: string; articles?: OcrArticle[] };

// What the censor closed (redactions.json plus scripts/redaction-rules.json): a closed byline
// must not reach the public author search.
export type Closure = { sheet?: number; phrase?: string; article?: string; name?: string };

export type BylineEntry = { id: string; sheet: number; kind: 'article' | 'letter'; title: string | null; byline: string };
export type CaptionEntry = { id: string; sheet: number; text: string };

const norm = (value: string) => value.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

// Like the approval prompt: pager and TV pages give no bylines for the search.
export const skipsBylines = (sheet: OcrSheet) => sheet.pageType === 'pager' || sheet.pageType === 'tv';

export function bylineEntries(sheetNo: number, sheet: OcrSheet): BylineEntry[] {
  if (skipsBylines(sheet)) return [];
  return (sheet.articles ?? []).flatMap((article, index) => {
    const byline = article.byline?.replace(/\s+/g, ' ').trim();
    // Ads sign with a firm, captions are credits (below), neither is an author.
    if (!byline || article.kind === 'ad' || article.kind === 'caption') return [];
    const title = (article.title ?? article.rubric)?.replace(/\s+/g, ' ').trim() || null;
    return [{ id: `${sheetNo}-${index}`, sheet: sheetNo, kind: article.kind === 'letter' ? 'letter' : 'article', title, byline }];
  });
}

// Photo and drawing credits sit in captions («Фото Ивана Петрова», «Рис. Злата»).
export function captionEntries(sheetNo: number, sheet: OcrSheet): CaptionEntry[] {
  if (skipsBylines(sheet)) return [];
  return (sheet.articles ?? []).flatMap((article, index) => {
    const text = [article.text, article.byline].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    if (article.kind !== 'caption' || !/(фото|рис\.|рисун|художник)/i.test(text)) return [];
    return [{ id: `${sheetNo}-${index}`, sheet: sheetNo, text: text.slice(0, 300) }];
  });
}

type RedactionItem = { sheet?: number; approved?: boolean; keep?: boolean; find?: string; text?: string[]; word?: string; article?: string; name?: string };

export function closuresFrom(items: RedactionItem[], ruleNames: { name: string }[] = []): Closure[] {
  const closures: Closure[] = [];
  for (const item of items) {
    if (!item.approved) continue;
    if (item.name) closures.push({ name: item.name });
    if (item.article) closures.push({ sheet: item.sheet, article: item.article });
    for (const phrase of [item.find, item.word, ...(item.text ?? [])]) if (phrase) closures.push({ sheet: item.sheet, phrase });
  }
  // A global surname is closed unless the issue explicitly kept it.
  for (const rule of ruleNames)
    if (!items.some((item) => item.name === rule.name && item.keep)) closures.push({ name: rule.name });
  return closures;
}

export function isClosed(sheetNo: number, title: string | null, byline: string, closures: Closure[]): boolean {
  const text = norm(byline);
  const words = new Set(text.split(' '));
  return closures.some((closure) => {
    if (closure.sheet !== undefined && closure.sheet !== sheetNo) return false;
    if (closure.name) return norm(closure.name).split(' ').every((word) => [...words].some((w) => w.startsWith(word)));
    if (closure.article) return !!title && norm(title).includes(norm(closure.article));
    const phrase = norm(closure.phrase ?? '');
    return !!phrase && !!text && (text.includes(phrase) || phrase.includes(text));
  });
}

// One sheet in the shape the approval recognition stores (recognition_runs.raw_json) and
// creditsFromSheet reads. `authors` holds the clean names per byline id, `credits` per caption id.
export function sheetResult(
  sheetNo: number,
  sheet: OcrSheet,
  closures: Closure[],
  authors: Record<string, string[]>,
  credits: Record<string, { kind: 'photo' | 'drawing'; name: string }[]>,
): SheetResult & { pageType: string } {
  const pageType = skipsBylines(sheet) ? (sheet.pageType as string) : 'regular';
  const articles = bylineEntries(sheetNo, sheet)
    .filter((entry) => !isClosed(sheetNo, entry.title, entry.byline, closures))
    .map((entry) => ({ kind: entry.kind, title: entry.title, byline: entry.byline, authors: authors[entry.id] ?? [] }))
    // No clean name means the byline was not a person («От ред.» is still one: the model keeps it).
    .filter((article) => article.authors.length > 0);
  // The raw caption is checked too: the model puts names in the nominative, a closure keeps the printed case.
  const found = captionEntries(sheetNo, sheet)
    .filter((entry) => !isClosed(sheetNo, null, entry.text, closures))
    .flatMap((entry) => credits[entry.id] ?? [])
    .filter((credit) => !isClosed(sheetNo, null, credit.name, closures));
  return { pageType, articles, credits: found };
}
