// Site routes are hashes («#issue-…», «#year-2000», «#about»), except the «Пейджер» section,
// which has real paths: «/pager/Спорти». Caddy serves index.html for them (deploy/Caddyfile).
// Moving between the two goes through history, so Back works and no page reloads.

export const ROUTE_EVENT = 'pilot:route';

/** Goes to a path or a «/#hash» without a reload and tells the route listeners. */
export function go(url: string, replace = false) {
  if (replace) window.history.replaceState(null, '', url);
  else window.history.pushState(null, '', url);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

/** Calls back on any route change: a hash link, Back/Forward or go(). */
export function onRoute(callback: () => void) {
  for (const type of ['hashchange', 'popstate', ROUTE_EVENT]) window.addEventListener(type, callback);
  return () => {
    for (const type of ['hashchange', 'popstate', ROUTE_EVENT]) window.removeEventListener(type, callback);
  };
}

/**
 * Plain links keep working: «/pager…» and «/#issue-…» open without a reload, and a hash link on a pager path
 * («#issue-…» under «/pager/Спорти») goes to «/#issue-…», so the address is not «/pager/Спорти#issue-…».
 */
export function routeLinks() {
  const onClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = (event.target as Element | null)?.closest?.('a');
    if (!link || link.target || link.hasAttribute('download')) return;
    const href = link.getAttribute('href') ?? '';
    if (href === '/pager' || href.startsWith('/pager/') || href.startsWith('/#')) {
      event.preventDefault();
      go(href);
    } else if (href.startsWith('#') && window.location.pathname !== '/') {
      event.preventDefault();
      go(`/${href}`);
    }
  };
  document.addEventListener('click', onClick);
  return () => document.removeEventListener('click', onClick);
}
