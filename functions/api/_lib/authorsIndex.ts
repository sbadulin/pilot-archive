// Explicit extension: tests load this module directly through Node's type stripping.
import { variantKey } from '../../../src/authorNames.ts';

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
export type IndexName = { name: string; key: string; credits: IndexCredit[] };

// The public search index: one entry per spelling of a name, each with the pages it signed.
export function composeAuthorsIndex(rows: CreditRow[], version = Date.now()) {
  const groups = new Map<string, { spellings: Map<string, number>; key: string; credits: Map<string, IndexCredit> }>();
  for (const row of rows) {
    const id = variantKey(row.name);
    const group = groups.get(id) ?? { spellings: new Map(), key: row.nameKey, credits: new Map() };
    groups.set(id, group);
    group.spellings.set(row.name, (group.spellings.get(row.name) ?? 0) + 1);
    const issue = `${row.year}-${row.number}-${row.serial}`;
    const credit = { issue, page: row.page, kind: row.kind, title: row.title };
    group.credits.set(`${issue}/${row.page}/${row.title ?? ''}`, credit);
  }
  const names: IndexName[] = [...groups.values()].map((group) => ({
    name: [...group.spellings].sort((a, b) => b[1] - a[1])[0][0],
    key: group.key,
    credits: [...group.credits.values()].sort((a, b) => a.issue.localeCompare(b.issue) || a.page - b.page),
  }));
  names.sort((a, b) => a.key.localeCompare(b.key, 'ru'));
  return { version, names };
}
