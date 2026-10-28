// A direct link to an author's card: «/?author=Захар+Веселов» opens the archive with the author search
// on that name. The query keeps letters as letters and a space as «+», so the link stays readable;
// only what would break it is escaped.

export const authorHref = (name: string) =>
  `/?author=${name.trim().replace(/[%&#+?=]/g, (ch) => encodeURIComponent(ch)).replace(/\s+/g, '+')}`;

/** The name asked for in the address, if any. */
export const linkedAuthor = (search = window.location.search) => new URLSearchParams(search).get('author')?.trim() || null;

/** Shows the open card in the address (or removes it), without a new history step. */
export function showAuthorInAddress(name: string | null) {
  const { pathname, hash } = window.location;
  const search = name ? authorHref(name).slice(1) : '';
  const target = `${pathname}${search.startsWith('?') ? search : ''}${hash}`;
  if (target !== `${pathname}${window.location.search}${hash}`) window.history.replaceState(null, '', target);
}
