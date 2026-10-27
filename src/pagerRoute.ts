// Routes of the «Пейджер» section: /pager, /pager/<nick>, /pager/<nick>/<tab>,
// /pager/<nick>/dialogs/<other>. The first links were hashes («#pager/Спорти»): they still open
// and are moved to the path. Kept apart from pagerFeed.ts because the app shell needs only these;
// the rest of the section is a lazily loaded chunk.

export type PagerTab = 'own' | 'about' | 'remarks' | 'articles' | 'dialogs';
export const PAGER_TABS: PagerTab[] = ['own', 'about', 'remarks', 'articles', 'dialogs'];
export type PagerRoute = { nick: string | null; tab: PagerTab; with: string | null };

const decode = (part: string | undefined) => {
  if (!part) return null;
  try {
    return decodeURIComponent(part) || null;
  } catch {
    return null;
  }
};

export function isPagerHash(hash: string) {
  return hash === '#pager' || hash.startsWith('#pager/');
}

export function parsePagerRoute(hash: string): PagerRoute | null {
  if (!isPagerHash(hash)) return null;
  const [, nick, tab, other] = hash.replace(/^#/, '').split('/');
  const known = PAGER_TABS.includes(tab as PagerTab) ? (tab as PagerTab) : 'own';
  return { nick: decode(nick), tab: known, with: known === 'dialogs' ? decode(other) : null };
}

// A readable link: «#pager/Спорти», not «#pager/%D0%A1…». Only what would break the link is
// encoded: the path separator, the fragment and query marks, the escape itself and spaces.
const segment = (name: string) => name.replace(/[%/#?\s"<>`]/gu, (ch) => encodeURIComponent(ch));

export function pagerHash(nick?: string | null, tab: PagerTab = 'own', other?: string | null): string {
  if (!nick) return '#pager';
  const base = `#pager/${segment(nick)}`;
  if (tab === 'dialogs' && other) return `${base}/dialogs/${segment(other)}`;
  return tab === 'own' ? base : `${base}/${tab}`;
}

/** The section's link: «/pager/Спорти». */
export const pagerPath = (nick?: string | null, tab: PagerTab = 'own', other?: string | null) =>
  `/${pagerHash(nick, tab, other).slice(1)}`;

export const isPagerPath = (pathname: string) => pathname === '/pager' || pathname.startsWith('/pager/');

/**
 * The route of an address. A hash link opened from the section wins over its path; an old
 * «#pager/…» link is read as its path.
 */
export function pagerRouteOf(pathname: string, hash: string): PagerRoute | null {
  if (isPagerHash(hash)) return parsePagerRoute(hash);
  if (hash && hash !== '#') return null;
  return isPagerPath(pathname) ? parsePagerRoute(`#${pathname.replace(/\/+$/, '').slice(1)}`) : null;
}

// The browser keeps a URL percent-encoded (location.href is «#pager/%D0%A1…») and copying the
// address bar gives that, whatever the bar shows. For sharing, letters come back as letters; ASCII
// escapes (%20, %25, %2F…) stay, or a messenger would cut the link at a space.
export function readableUrl(href: string): string {
  return href.replace(/(?:%[89a-f][0-9a-f])+/giu, (bytes) => {
    try {
      return decodeURIComponent(bytes);
    } catch {
      return bytes;
    }
  });
}
