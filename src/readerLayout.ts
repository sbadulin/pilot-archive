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
