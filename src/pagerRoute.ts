// Routes of the «Пейджер» section: #pager, #pager/<nick>, #pager/<nick>/<tab>,
// #pager/<nick>/dialogs/<other>. Kept apart from pagerFeed.ts because the app shell needs only
// these; the rest of the section is a lazily loaded chunk.

export type PagerTab = 'own' | 'about' | 'articles' | 'dialogs';
export const PAGER_TABS: PagerTab[] = ['own', 'about', 'articles', 'dialogs'];
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

export function pagerHash(nick?: string | null, tab: PagerTab = 'own', other?: string | null): string {
  if (!nick) return '#pager';
  const base = `#pager/${encodeURIComponent(nick)}`;
  if (tab === 'dialogs' && other) return `${base}/dialogs/${encodeURIComponent(other)}`;
  return tab === 'own' ? base : `${base}/${tab}`;
}
