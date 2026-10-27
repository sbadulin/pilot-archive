// Pure logic of the «Пейджер» section: routes, mentions, dialogs, search. The view is pagerView.tsx.
// Only 'unique' nicks have profiles (pager.json); addressees that look like a real «Имя Фамилия»
// are shown as printed but never linked, searched or collected (152-ФЗ).
import { normalizeName } from './authorNames.ts';
import { foldCase, matchesQuery, MIN_QUERY } from './authorSearch.ts';
import { classifyNick, nickCore, withAdjectives } from './pagerNicks.ts';
import { messageWhere, type PagerSite, type SiteMessage, type SiteProfile } from './pagerSite.ts';
import { printedPages } from './readerLayout.ts';

export { MIN_QUERY };
export { PAGER_TABS, isPagerHash, pagerHash, parsePagerRoute, type PagerRoute, type PagerTab } from './pagerRoute.ts';

// sheet is the PDF sheet; page and pages are the printed page the reader's links name and its label
// («8–9» for a spread), which differ after a two-page spread.
export type FeedMessage = { id: string; date: string; issue: string; sheet: number; page: number; pages: string; from: string | null; to: string[]; text: string; nicks: string[]; toKeys: (string | null)[] };
export type PagerModel = {
  messages: FeedMessage[]; // oldest first
  profiles: Map<string, SiteProfile>;
  own: Map<string, FeedMessage[]>; // profile key → its messages
  byName: Map<string, string>; // normalized name or spelling → profile key
  names: string[]; // every profile name and spelling, for cutting longer nicks out of texts
  featured: string[]; // search examples that have a profile
};

export function preparePager(site: PagerSite): PagerModel {
  const messages = site.messages.map((message: SiteMessage): FeedMessage => {
    const { issue, sheet } = messageWhere(message.id);
    // Only sheets before this one shift its number, so the count can stop at it.
    const numbering = printedPages(sheet, site.spreads?.[issue]);
    return { id: message.id, date: site.dates[issue] ?? '', issue, sheet, page: numbering.first(sheet), pages: numbering.label(sheet), from: message.from ?? null, to: message.to ?? [], text: message.text, nicks: message.nicks ?? [], toKeys: [] };
  });
  messages.sort((a, b) => a.date.localeCompare(b.date));
  const profiles = new Map(site.profiles.map((profile) => [profile.key, profile]));
  const byName = new Map<string, string>();
  // Keys are case-folded like the search (normalizeName leaves lowercase b, h, t Latin), so a
  // typed route «#pager/bad» or an addressee «bad» finds BAD.
  for (const profile of site.profiles) if (!byName.has(foldCase(profile.key))) byName.set(foldCase(profile.key), profile.key);
  for (const profile of site.profiles) {
    for (const name of [profile.name, ...profile.spellings]) {
      const key = foldCase(normalizeName(name));
      if (key && !byName.has(key)) byName.set(key, profile.key);
    }
  }
  const model: PagerModel = { messages, profiles, own: new Map(), byName, names: [], featured: [] };
  // Which addressees are profiles, worked out once: mentions, dialogs and links all need it.
  for (const message of messages) message.toKeys = message.to.map((name) => profileOf(model, name));
  const own = model.own;
  for (const message of messages) for (const key of message.nicks) own.set(key, [...(own.get(key) ?? []), message]);
  model.names = [...new Set(site.profiles.flatMap((profile) => [profile.name, ...profile.spellings]))];
  model.featured = (site.featured ?? []).filter((name) => profiles.has(byName.get(foldCase(normalizeName(name))) ?? ''));
  return model;
}

// The profile a printed name belongs to («Icepac (лэйбл Outlow)» → ICEPAC), or null.
export function profileOf(model: PagerModel, name: string): string | null {
  return model.byName.get(foldCase(normalizeName(nickCore(name)))) ?? model.byName.get(foldCase(normalizeName(name))) ?? null;
}

// «В газете»: the profile's signed materials, oldest first.
export const articlesOf = (model: PagerModel, key: string) =>
  [...(model.profiles.get(key)?.articles ?? [])].sort((a, b) => a.issue.localeCompare(b.issue) || a.page - b.page);

// --- Mentions ---

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isAllCaps = (name: string) => name === name.toUpperCase() && name !== name.toLowerCase();

// A name in a text: after a non-letter, any ending («BAD'a», «BADy»). Short names (up to 3 letters)
// only in their own case and as a whole word, except an all-caps nick before a lowercase ending:
// otherwise «Кот» would find every «Котёнок» and «Neo» every «Neon».
function namePattern(name: string): RegExp {
  const body = escapeRegExp(name);
  const letters = name.replace(/[^\p{L}\p{N}]/gu, '').length;
  if (letters > 3) return new RegExp(`(?:^|[^\\p{L}\\p{N}])${body}`, 'iu');
  const after = isAllCaps(name) ? '(?![\\p{Lu}\\p{N}])' : '(?![\\p{L}\\p{N}])';
  return new RegExp(`(?:^|[^\\p{L}\\p{N}])${body}${after}`, 'u');
}

// A remark someone added to another reader's message, signed in brackets: «(будет политинформация? –
// ПТ)». ПТ and ТТ of the editorial often did. A name alone in brackets («Рыженький (ПТ)») is not one.
const remarkPattern = (names: string[]) =>
  new RegExp(`\\([^()]*?[–—-]+\\s*(?:${names.map((name) => escapeRegExp(name.trim())).join('|')})\\s*\\)`, 'giu');
const profileNames = (profile: SiteProfile) => [...new Set([profile.name, ...profile.spellings].filter((name) => name.trim()))];

/** Messages of other readers with a remark by the profile, oldest first; only the editorial made them. */
export function remarksOf(model: PagerModel, key: string): FeedMessage[] {
  const profile = model.profiles.get(key);
  if (!profile?.staff) return [];
  const pattern = remarkPattern(profileNames(profile));
  return model.messages.filter((message) => !message.nicks.includes(key) && message.text.search(pattern) >= 0);
}

/**
 * Messages addressed to the profile or naming it in the text, except its own. Longer nicks that
 * hold one of its names («Bad Girl», «Пашк.A not Bad» for «BAD») and the message's own signature,
 * often repeated at the end of the text, are cut out of the text first. Only adjectives before the
 * name («Умиротворенный BAD», «Мелированный Виталя Мэнсон») is the same person: it stays. The
 * profile's own remarks in other messages («(…– ПТ)») are its words, not a mention.
 */
export function mentionsOf(model: PagerModel, key: string): FeedMessage[] {
  const profile = model.profiles.get(key);
  if (!profile) return [];
  const names = profileNames(profile);
  const remarks = remarkPattern(names);
  const lower = names.map((name) => name.toLocaleLowerCase('ru'));
  const longer = model.names
    .filter((other) => {
      const value = other.toLocaleLowerCase('ru');
      return !lower.includes(value) && lower.some((name) => value.includes(name)) && !names.some((name) => withAdjectives(other, name));
    })
    .sort((a, b) => b.length - a.length)
    .map((other) => new RegExp(escapeRegExp(other), 'giu'));
  const patterns = names.map(namePattern);
  return model.messages.filter((message) => {
    if (message.nicks.includes(key)) return false;
    if (message.toKeys.includes(key)) return true;
    const from = message.from?.trim() ?? '';
    const described = names.some((name) => withAdjectives(nickCore(from), name));
    const signature = from && !described ? [new RegExp(escapeRegExp(from), 'giu')] : [];
    const text = [remarks, ...signature, ...longer].reduce((acc, pattern) => acc.replace(pattern, ' '), message.text);
    return patterns.some((pattern) => pattern.test(text));
  });
}

// --- Dialogs ---

export type Dialog = { other: string; messages: FeedMessage[]; mine: number; theirs: number };

/**
 * The profile's exchanges with other profiles: its messages addressed to X and X's messages
 * addressed to it or naming it. Two-sided conversations first, then the longest.
 */
export function dialogsOf(model: PagerModel, key: string, mentions = mentionsOf(model, key)): Dialog[] {
  const threads = new Map<string, Dialog>();
  const add = (other: string, message: FeedMessage, mine: boolean) => {
    if (other === key || !model.profiles.has(other)) return;
    let thread = threads.get(other);
    if (!thread) threads.set(other, (thread = { other, messages: [], mine: 0, theirs: 0 }));
    if (thread.messages.includes(message)) return;
    thread.messages.push(message);
    if (mine) thread.mine++;
    else thread.theirs++;
  };
  for (const message of model.own.get(key) ?? []) {
    for (const other of message.toKeys) if (other) add(other, message, true);
  }
  for (const message of mentions) for (const author of message.nicks) add(author, message, false);
  for (const thread of threads.values()) thread.messages.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id, 'en', { numeric: true }));
  const name = (other: string) => model.profiles.get(other)?.name ?? other;
  return [...threads.values()].sort(
    (a, b) =>
      Number(b.mine > 0 && b.theirs > 0) - Number(a.mine > 0 && a.theirs > 0) ||
      b.messages.length - a.messages.length ||
      name(a.other).localeCompare(name(b.other), 'ru'),
  );
}

// --- Part of a message addressed to someone ---

// First place a name opens a sentence (a greeting: «… кстати. Туса, я там…», «99. Ice!»), case aside;
// -1 when absent. A name inside a sentence («спасибо BADy, Rat и Хавчу») is not a greeting.
const findName = (text: string, name: string) => {
  const match = new RegExp(`(^|[.!?…)»]\\s+|\\n\\s*|^\\d+\\.\\s+)(${escapeRegExp(name.trim())})(?![\\p{L}\\p{N}]{3})`, 'iu').exec(text);
  return match ? match.index + match[1].length : -1;
};

/**
 * The part of a message addressed to `key`: from where its name appears in the text to where the
 * next addressee's name starts («Туса, я там везде стоял. Спорти! …» → «Туса, я там везде стоял.»).
 * Null when the name isn't found or the whole message is for them: show it all then.
 */
export function excerptFor(model: PagerModel, message: FeedMessage, key: string): string | null {
  const profile = model.profiles.get(key);
  if (!profile) return null;
  const own = [profile.name, ...profile.spellings, ...message.to.filter((_, i) => message.toKeys[i] === key)];
  const starts = own.map((name) => findName(message.text, name)).filter((at) => at >= 0);
  if (!starts.length) return null;
  const start = Math.min(...starts);
  const others = message.to.filter((_, i) => message.toKeys[i] !== key);
  const end = Math.min(message.text.length, ...others.map((name) => findName(message.text, name)).filter((at) => at > start));
  // A «P.S.» that opens the next greeting belongs to it, not to the end of this part.
  const part = message.text.slice(start, end).replace(/\s*(?:P\.?\s*S\.?|П\.?\s*С\.?)\s*$/iu, '').trim();
  return part && part !== message.text.trim() ? part : null;
}

// --- Search ---

// «Имя Фамилия» at the start of an addressee: a real person, never searchable.
const REAL_NAME = /^[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:\s|$)/u;
export const isSearchableAddressee = (name: string) => !REAL_NAME.test(name.trim()) && classifyNick(name) !== 'realName';

export type PagerHit =
  | { kind: 'author'; key: string; name: string; count: number; keys: string[] }
  | { kind: 'to'; key: string; name: string; count: number; keys: string[] };

export function pagerSearchIndex(model: PagerModel): PagerHit[] {
  const authors: PagerHit[] = [...model.profiles.values()].map((profile) => ({
    kind: 'author',
    key: profile.key,
    name: profile.name,
    count: model.own.get(profile.key)?.length ?? 0,
    keys: [...new Set([profile.key, ...[profile.name, ...profile.spellings].map((name) => normalizeName(name))])],
  }));
  const addressees = new Map<string, { spellings: Map<string, number>; count: number }>();
  for (const message of model.messages) {
    const seen = new Set<string>();
    message.to.forEach((name, i) => {
      if (message.toKeys[i] || seen.has(name) || !isSearchableAddressee(name)) return;
      seen.add(name);
      const key = normalizeName(name);
      if (!key) return;
      let entry = addressees.get(key);
      if (!entry) addressees.set(key, (entry = { spellings: new Map(), count: 0 }));
      entry.count++;
      entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
    });
  }
  const to: PagerHit[] = [...addressees].map(([key, entry]) => ({
    kind: 'to',
    key,
    name: [...entry.spellings].sort((a, b) => b[1] - a[1])[0][0],
    count: entry.count,
    keys: [key],
  }));
  return [...authors, ...to];
}

// Exact names first («bad» → BAD before Bad Girl), then nicks with a profile, then addressees;
// addressees keep a couple of places even when many nicks match.
export function searchPager(index: PagerHit[], query: string, limit = 8): PagerHit[] {
  if (query.trim().length < MIN_QUERY) return [];
  const exact = foldCase(normalizeName(query));
  const rank = (hit: PagerHit) => (hit.keys.some((key) => foldCase(key) === exact) ? 0 : 1);
  const order = (a: PagerHit, b: PagerHit) => rank(a) - rank(b) || b.count - a.count || a.name.localeCompare(b.name, 'ru');
  const found = index.filter((hit) => matchesQuery(query, hit.keys));
  const authors = found.filter((hit) => hit.kind === 'author').sort(order);
  const to = found.filter((hit) => hit.kind === 'to').sort(order);
  const toPlaces = Math.min(to.length, Math.max(2, limit - authors.length));
  return [...authors.slice(0, limit - toPlaces), ...to.slice(0, toPlaces)].sort((a, b) => rank(a) - rank(b));
}

// Messages addressed to a searched addressee (by its normalized name).
export const addressedTo = (model: PagerModel, key: string) =>
  model.messages.filter((message) => message.to.some((name) => normalizeName(name) === key));

// --- Labels ---

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

// «2000-03» → «Март 2000».
export function monthLabel(month: string): string {
  const name = MONTHS[Number(month.slice(5, 7)) - 1] ?? '';
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${month.slice(0, 4)}`.trim();
}

// «2000-03-08» → «8 марта 2000».
export function dateLabel(date: string): string {
  const month = MONTHS_OF[Number(date.slice(5, 7)) - 1];
  return month ? `${Number(date.slice(8, 10))} ${month} ${date.slice(0, 4)}` : date;
}

// «2000-01-0066» → the parts issueLabel needs.
export function issueParts(issue: string) {
  const [year, number, serial] = issue.split('-');
  return { year: Number(year), number, serial };
}

export function pluralWord(count: number, one: string, few: string, many: string) {
  const tens = count % 100;
  const units = count % 10;
  return units === 1 && tens !== 11 ? one : units >= 2 && units <= 4 && (tens < 10 || tens >= 20) ? few : many;
}

export const plural = (count: number, one: string, few: string, many: string) => `${count} ${pluralWord(count, one, few, many)}`;
