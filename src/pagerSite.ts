// Data of the public «Пейджер» section (/archive/pager.json), built from pager-public.json by
// scripts/pager-site.mjs. Nick rules are the same as in pager-nicks.json (src/pagerNicks.ts):
// aliases, joint signatures (one message in each author's profile), shared signatures (no profile).
// Only 'unique' nicks get a profile. Addressees stay as printed and are never aggregated here.
import { normalizeName } from './authorNames.ts';
import { buildNicks, nickKey, signatureAuthors, type NickRules } from './pagerNicks.ts';

export type PublicPagerMessage = {
  id: string;
  year: number;
  number: string;
  serial: string;
  date: string;
  sheet: number;
  from: string | null;
  to: string[];
  text: string;
  hold?: boolean;
};

// Empty fields are left out to keep the file small: no from → unsigned, no to → nobody, no nicks → no profile.
// The issue and the sheet are read from the id (messageWhere), the date from the issue (PagerSite.dates).
export type SiteMessage = { id: string; from?: string; to?: string[]; text: string; nicks?: string[] };
export type SiteArticle = { issue: string; page: number; kind: string; title: string | null };
export type SiteProfile = { key: string; name: string; spellings: string[]; messages: number; first: string; last: string; articles: SiteArticle[] };
// dates: issue key («2000-01-0066») → its date. spreads: issue key → its sheets scanned as two-page
// spreads (as the reader detects them), so a link can name the printed page and not the sheet.
// featured: profile names shown as search examples (scripts/pager-site.mjs picks them).
export type PagerSite = { version: 1; dates: Record<string, string>; spreads?: Record<string, number[]>; featured?: string[]; messages: SiteMessage[]; profiles: SiteProfile[] };

// «2000-01-0066-p12-3» → the issue «2000-01-0066» and the sheet 12.
export function messageWhere(id: string): { issue: string; sheet: number } {
  const match = id.match(/^(\d{4}-\d{2,3}-\d{4,5})-p(\d+)-\d+$/);
  if (!match) throw new Error(`Unexpected pager message id: ${id}`);
  return { issue: match[1], sheet: Number(match[2]) };
}
export type AuthorsIndex = { names: { key: string; keys?: string[]; credits: SiteArticle[] }[] };

// The recognizer sometimes retold a message instead of transcribing it: not the reader's words, not shown.
export const isRetold = (text: string) => /^\s*\[пересказ\]/iu.test(text);

// A page's running header («12 «ПП» • 5 апреля 2000 года…») read as a message.
export const isRunningHeader = (text: string) => /^\s*\d+\s+«ПП»\s+•/u.test(text);

export type SiteOptions = {
  // Editorial texts recognized as messages (scripts/pager-exclude.json): id → why.
  exclude?: Record<string, string>;
  spreads?: Record<string, number[]>;
};
export type SiteStats = { total: number; kept: number; dropped: { hold: number; retold: number; duplicate: number; editorial: number }; profiles: number; withArticles: number };

// --- Messages recognized twice ---
// A page read in overlapping parts can give one message twice with small differences
// («МЕС! …, а, если понравимся?» / «Мес! …? А если понравимся?»). Same page, same signature and
// near-identical text is one message; a different leading number («33.» / «123.», a reprint) or ad
// code («М-277» / «М-278») keeps both.
const plainText = (text: string) => text.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, '');
const leadingCode = (text: string) => text.trim().match(/^(?:\d+\.|[МДMD]\s*-\s*\d+)/iu)?.[0].replace(/\s+/g, '').toLowerCase() ?? null;
function similarity(a: string, b: string) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) pairs.set(a.slice(i, i + 2), (pairs.get(a.slice(i, i + 2)) ?? 0) + 1);
  let common = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const pair = b.slice(i, i + 2);
    const count = pairs.get(pair) ?? 0;
    if (count) (common++, pairs.set(pair, count - 1));
  }
  return (2 * common) / (a.length + b.length - 2);
}
export function isDuplicate(a: PublicPagerMessage, b: PublicPagerMessage): boolean {
  if (a.year !== b.year || a.number !== b.number || a.serial !== b.serial || a.sheet !== b.sheet) return false;
  if (normalizeName(a.from ?? '') !== normalizeName(b.from ?? '')) return false;
  const [codeA, codeB] = [leadingCode(a.text), leadingCode(b.text)];
  if (codeA && codeB && codeA !== codeB) return false;
  const [textA, textB] = [plainText(a.text), plainText(b.text)];
  return Math.min(textA.length, textB.length) >= 15 && similarity(textA, textB) >= 0.9;
}

// Only the shown issues that have spreads, so the file carries nothing it does not need.
function spreadsOf(dates: Record<string, string>, spreads: Record<string, number[]> = {}) {
  const shown = Object.entries(spreads).filter(([issue, sheets]) => issue in dates && sheets.length);
  return shown.length ? { spreads: Object.fromEntries(shown) } : {};
}

export function buildPagerSite(all: PublicPagerMessage[], rules: NickRules, authors: AuthorsIndex, options: SiteOptions = {}): { site: PagerSite; stats: SiteStats } {
  const dropped = { hold: 0, retold: 0, duplicate: 0, editorial: 0 };
  const kept: PublicPagerMessage[] = [];
  for (const message of all) {
    if (options.exclude?.[message.id] || isRunningHeader(message.text)) { dropped.editorial++; continue; }
    if (isRetold(message.text)) { dropped.retold++; continue; }
    if (message.hold) { dropped.hold++; continue; }
    if (kept.some((earlier) => isDuplicate(earlier, message))) { dropped.duplicate++; continue; }
    kept.push(message);
  }
  const shown = kept;
  // Profiles count only what is shown, so a held message adds no spelling and no date.
  const nicks = buildNicks(shown, rules).filter((nick) => nick.unique);
  const unique = new Set(nicks.map((nick) => nick.key));

  const byKey = new Map<string, SiteArticle[]>();
  for (const entry of authors.names) {
    for (const key of entry.keys ?? [entry.key]) byKey.set(key, [...(byKey.get(key) ?? []), ...entry.credits]);
  }
  const profiles: SiteProfile[] = nicks.map((nick) => {
    const keys = new Set([nick.key, ...nick.spellings.map((spelling) => normalizeName(spelling))]);
    const seen = new Set<string>();
    const articles = [...keys]
      .flatMap((key) => byKey.get(key) ?? [])
      // The pager's own lines are the feed itself, not material «in the newspaper».
      .filter((credit) => credit.kind !== 'pager')
      .filter((credit) => {
        const id = `${credit.issue}|${credit.page}|${credit.title ?? ''}`;
        return !seen.has(id) && (seen.add(id), true);
      })
      .map(({ issue, page, kind, title }) => ({ issue, page, kind, title }))
      .sort((a, b) => a.issue.localeCompare(b.issue) || a.page - b.page);
    return {
      key: nick.key,
      name: nick.name,
      spellings: nick.spellings.filter((spelling) => spelling !== nick.name),
      messages: nick.messages,
      first: nick.first,
      last: nick.last,
      articles,
    };
  });

  const dates: Record<string, string> = {};
  const messages: SiteMessage[] = [...shown]
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id, 'en', { numeric: true }))
    .map((message) => {
      const from = message.from?.trim() || undefined;
      const keys = from ? [...new Set(signatureAuthors(from, rules).authors.map((author) => nickKey(author, rules)))].filter((key) => unique.has(key)) : [];
      const to = message.to.filter((name) => name.trim());
      const issue = `${message.year}-${message.number}-${message.serial}`;
      if (messageWhere(message.id).issue !== issue || messageWhere(message.id).sheet !== message.sheet) throw new Error(`Id ${message.id} does not match its issue and sheet`);
      dates[issue] = message.date;
      return {
        id: message.id,
        ...(from ? { from } : {}),
        ...(to.length ? { to } : {}),
        text: message.text,
        ...(keys.length ? { nicks: keys } : {}),
      };
    });

  return {
    site: { version: 1, dates, ...spreadsOf(dates, options.spreads), messages, profiles },
    stats: { total: all.length, kept: messages.length, dropped, profiles: profiles.length, withArticles: profiles.filter((profile) => profile.articles.length).length },
  };
}
