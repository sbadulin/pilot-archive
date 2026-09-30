// Explicit extension: tests load this module directly through Node's type stripping.
import { oneSubstitutionOrGap, variantKey } from '../../../src/authorNames.ts';

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

type Variant = { name: string; key: string; words: string[]; credits: Map<string, IndexCredit>; rubrics: Set<string> };
type Head = Variant & { aliases: string[]; keys: string[] };

// Short words differ by one letter too easily («Катя» / «Каня») to be taken as a misreading.
const MIN_WORD = 5;

function variants(rows: CreditRow[]): Variant[] {
  // A column keeps its heading from issue to issue; the first two words are enough to recognise it.
  const rubrics = new Map<string, string>();
  const rubric = (title: string) => {
    let r = rubrics.get(title);
    // Only compared with other rubrics, so a cheap lowercase split will do (no Unicode regex to compile).
    if (r === undefined) rubrics.set(title, (r = title.toLowerCase().replace(/ё/g, 'е').split(/[^a-zа-я0-9]+/).filter(Boolean).slice(0, 2).join(' ')));
    return r;
  };
  const groups = new Map<string, { spellings: Map<string, number>; key: string; credits: Map<string, IndexCredit>; rubrics: Set<string> }>();
  for (const row of rows) {
    const id = variantKey(row.name);
    let group = groups.get(id);
    if (!group) groups.set(id, (group = { spellings: new Map(), key: row.nameKey, credits: new Map(), rubrics: new Set() }));
    group.spellings.set(row.name, (group.spellings.get(row.name) ?? 0) + 1);
    const issue = `${row.year}-${row.number}-${row.serial}`;
    group.credits.set(`${issue}/${row.page}/${row.title ?? ''}`, { issue, page: row.page, kind: row.kind, title: row.title });
    // Letters columns share one heading across many readers, so only articles count as a rubric.
    if (row.kind === 'article' && row.title) {
      const r = rubric(row.title);
      if (r) group.rubrics.add(r);
    }
  }
  return [...groups.values()].map((g) => ({
    name: [...g.spellings].sort((a, b) => b[1] - a[1])[0][0],
    key: g.key,
    words: g.key.split(' '),
    credits: g.credits,
    rubrics: g.rubrics,
  }));
}

// Blocks: the name with one long word left out. Names one letter apart in that word share
// a block, so only names within a block are compared — not every name with every other.
const blocks = (words: string[]) =>
  words.flatMap((word, i) => (word.length >= MIN_WORD ? [`${words.length}|${i}|${words.filter((_, j) => j !== i).join(' ')}`] : []));

// The public search index: one entry per name, each with the pages it signed.
// A spelling one letter off a more frequent one under the same article rubric is taken as a
// misreading and folded into it («Васиуалий ЛОПАТА» → «Васисуалий ЛОПАТА»).
export function composeAuthorsIndex(rows: CreditRow[], version = Date.now()) {
  const sorted = variants(rows).sort((a, b) => b.credits.size - a.credits.size || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const heads: Head[] = [];
  const byBlock = new Map<string, Head[]>();
  for (const v of sorted) {
    const keys = blocks(v.words);
    let head: Head | undefined;
    for (const block of keys) {
      const i = Number(block.split('|')[1]);
      head = byBlock.get(block)?.find((h) =>
        h.credits.size > v.credits.size &&
        h.words[i].length >= MIN_WORD &&
        oneSubstitutionOrGap(h.words[i], v.words[i]) &&
        [...v.rubrics].some((r) => h.rubrics.has(r)));
      if (head) break;
    }
    if (!head) {
      const created: Head = { ...v, credits: new Map(v.credits), aliases: [], keys: [v.key] };
      heads.push(created);
      for (const block of keys) byBlock.set(block, [...(byBlock.get(block) ?? []), created]);
      continue;
    }
    head.aliases.push(v.name);
    if (!head.keys.includes(v.key)) head.keys.push(v.key);
    for (const [id, credit] of v.credits) head.credits.set(id, credit);
  }
  const names: IndexName[] = heads.map((h) => ({
    name: h.name,
    key: h.key,
    keys: h.keys,
    aliases: h.aliases,
    credits: [...h.credits.values()].sort((a, b) => (a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : a.page - b.page)),
  }));
  names.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return { version, names };
}
