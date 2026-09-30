// Explicit extension: tests load this module directly through Node's type stripping.
import { normalizeName, similarNames, variantKey } from '../../../src/authorNames.ts';

export type CreditRow = {
  year: number;
  number: string;
  serial: string;
  page: number;
  kind: string;
  title: string | null;
  name: string;
  nameKey: string;
};

export type IndexCredit = { issue: string; page: number; kind: string; title: string | null };
// name — the spelling shown; aliases — other spellings merged into it; keys — search keys of all of them.
export type IndexName = { name: string; key: string; keys: string[]; aliases: string[]; credits: IndexCredit[] };

type Variant = { name: string; key: string; credits: Map<string, IndexCredit>; rubrics: Set<string> };

// A column keeps its heading from issue to issue; the first two words are enough to recognise it.
const rubric = (title: string | null) => normalizeName(title ?? '').split(' ').slice(0, 2).join(' ');

function variants(rows: CreditRow[]): Variant[] {
  const groups = new Map<string, { spellings: Map<string, number>; key: string; credits: Map<string, IndexCredit>; rubrics: Set<string> }>();
  for (const row of rows) {
    const id = variantKey(row.name);
    const group = groups.get(id) ?? { spellings: new Map(), key: row.nameKey, credits: new Map(), rubrics: new Set() };
    groups.set(id, group);
    group.spellings.set(row.name, (group.spellings.get(row.name) ?? 0) + 1);
    const issue = `${row.year}-${row.number}-${row.serial}`;
    group.credits.set(`${issue}/${row.page}/${row.title ?? ''}`, { issue, page: row.page, kind: row.kind, title: row.title });
    // Letters columns share one heading across many readers, so only articles count as a rubric.
    if (row.kind === 'article' && rubric(row.title)) group.rubrics.add(rubric(row.title));
  }
  return [...groups.values()].map((g) => ({
    name: [...g.spellings].sort((a, b) => b[1] - a[1])[0][0],
    key: g.key,
    credits: g.credits,
    rubrics: g.rubrics,
  }));
}

// The public search index: one entry per name, each with the pages it signed.
// A spelling one letter off a more frequent one under the same rubric is taken as a
// misreading and folded into it («Васиуалий ЛОПАТА» → «Васисуалий ЛОПАТА»).
export function composeAuthorsIndex(rows: CreditRow[], version = Date.now()) {
  const sorted = variants(rows).sort((a, b) => b.credits.size - a.credits.size || a.key.localeCompare(b.key, 'ru'));
  const heads: (Variant & { aliases: string[]; keys: string[] })[] = [];
  for (const v of sorted) {
    const head = heads.find((h) => h.credits.size > v.credits.size && similarNames(h.name, v.name) && [...v.rubrics].some((r) => h.rubrics.has(r)));
    if (!head) { heads.push({ ...v, credits: new Map(v.credits), aliases: [], keys: [v.key] }); continue; }
    head.aliases.push(v.name);
    if (!head.keys.includes(v.key)) head.keys.push(v.key);
    for (const [id, credit] of v.credits) head.credits.set(id, credit);
  }
  const names: IndexName[] = heads.map((h) => ({
    name: h.name,
    key: h.key,
    keys: h.keys,
    aliases: h.aliases,
    credits: [...h.credits.values()].sort((a, b) => a.issue.localeCompare(b.issue) || a.page - b.page),
  }));
  names.sort((a, b) => a.key.localeCompare(b.key, 'ru'));
  return { version, names };
}
