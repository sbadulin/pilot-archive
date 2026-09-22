export function groupSpreads(count: number, largePages: number[] = []): number[][] {
  if (count < 1) return [];
  const large = new Set(largePages);
  const groups: number[][] = [[1]];
  for (let page = 2; page <= count;) {
    if (page === count || large.has(page) || page + 1 === count || large.has(page + 1)) groups.push([page++]);
    else { groups.push([page, page + 1]); page += 2; }
  }
  return groups;
}

// A large sheet is a scanned two-page spread, so it carries two printed page numbers.
export function printedPages(count: number, largePages: number[] = []) {
  const large = new Set(largePages);
  const starts: number[] = [];
  let next = 1;
  for (let sheet = 1; sheet <= count; sheet++) {
    starts.push(next);
    next += large.has(sheet) ? 2 : 1;
  }
  const first = (sheet: number) => starts[sheet - 1] ?? sheet;
  return {
    total: next - 1,
    first,
    label: (sheet: number) => (large.has(sheet) ? `${first(sheet)}–${first(sheet) + 1}` : `${first(sheet)}`),
    sheetFor: (page: number) => {
      let sheet = 1;
      while (sheet < count && starts[sheet] <= page) sheet++;
      return sheet;
    },
  };
}
