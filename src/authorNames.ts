// Author names found in bylines, shared by the recognition script and the site search.

// Latin letters that look like Cyrillic ones; scans and models mix them freely («K.O.T.T.»).
const LOOKALIKES: Record<string, string> = {
  A: 'А', B: 'В', C: 'С', E: 'Е', H: 'Н', K: 'К', M: 'М', O: 'О', P: 'Р', T: 'Т', X: 'Х', Y: 'У',
  a: 'а', c: 'с', e: 'е', k: 'к', m: 'м', o: 'о', p: 'р', x: 'х', y: 'у', '@': 'а',
};

// Search key: one key for every spelling a reader would consider the same name.
export function normalizeName(name: string): string {
  return name
    .replace(/[ABCEHKMOPTXYacekmopxy@]/g, (ch) => LOOKALIKES[ch])
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Variant key: one search suggestion per spelling. Case, ё and a trailing dot do not make
// a new variant; a nick's own spelling («Svetk@», Latin letters) does.
export function variantKey(name: string): string {
  return name.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
}

export type CreditKind = 'article' | 'letter' | 'pager' | 'photo' | 'drawing' | 'other';

export type SheetArticle = { title?: string | null; byline?: string | null; authors?: string[]; kind?: string };
export type SheetResult = { articles?: SheetArticle[]; credits?: { kind?: string; name?: string | null }[] };

export type SheetContext = { year: number; number: string; serial: string; sheet: number; printedPage: number; source: string };

export type Credit = SheetContext & { kind: CreditKind; title: string | null; byline: string; name: string; nameKey: string };

const articleKind = (kind?: string): CreditKind => (kind === 'letter' || kind === 'pager' || kind === 'other' ? kind : 'article');

// One credit per distinct author name in each signed material on a sheet.
export function creditsFromSheet(result: SheetResult, context: SheetContext): Credit[] {
  const credits: Credit[] = [];
  const add = (kind: CreditKind, title: string | null, byline: string, names: string[]) => {
    const seen = new Set<string>();
    for (const raw of names) {
      const name = raw.trim();
      const nameKey = normalizeName(name);
      if (!nameKey || seen.has(nameKey)) continue;
      seen.add(nameKey);
      credits.push({ ...context, kind, title, byline, name, nameKey });
    }
  };
  for (const article of result.articles ?? []) {
    // Bylines come back with the scan's line breaks («Князь Тишины\n& Punisher»).
    const byline = article.byline?.replace(/\s+/g, ' ').trim();
    if (!byline) continue;
    add(articleKind(article.kind), article.title?.trim() || null, byline, article.authors?.length ? article.authors : [byline]);
  }
  for (const credit of result.credits ?? []) {
    const name = credit.name?.trim();
    if (!name) continue;
    add(credit.kind === 'drawing' ? 'drawing' : 'photo', null, name, [name]);
  }
  return credits;
}
