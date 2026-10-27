// «Пейджер» views are hash routes and never reach the server, so they are reported
// with the same anonymous beacon as the author search: GET /_stats/pager → Caddy 204.
// Only nicknames from the newspaper are sent, never real names of addressees.
import {MAX_EVENT_TEXT, normalizeEventText, sendEvent} from './authorAnalytics.ts';

export type PagerEvent = 'open' | 'profile' | 'dialog' | 'search' | 'select';
export type PagerSelectKind = 'author' | 'to';
export type PagerParams = {nick?: string; with?: string; q?: string; found?: number; kind?: PagerSelectKind};

// Two-letter nicknames exist, so pager searches start at two characters.
export const PAGER_MIN_QUERY = 2;
export const PAGER_SEARCH_PAUSE_MS = 1200;

function text(value: string | undefined, minimum: number, lower: boolean): string | null {
  if (value === undefined) return null;
  const result = normalizeEventText(value, lower);
  return result.length >= minimum && result.length <= MAX_EVENT_TEXT ? result : null;
}

export function pagerEventUrl(event: PagerEvent, input: PagerParams = {}): string | null {
  const params = new URLSearchParams({event});
  if (event === 'profile' || event === 'dialog') {
    const nick = text(input.nick, 1, false);
    if (!nick) return null;
    params.set('nick', nick);
    if (event === 'dialog') {
      const other = text(input.with, 1, false);
      if (!other) return null;
      params.set('with', other);
    }
  } else if (event === 'search') {
    const q = text(input.q, PAGER_MIN_QUERY, true);
    if (!q || input.found === undefined) return null;
    params.set('q', q);
    params.set('found', input.found > 0 ? '1' : '0');
  } else if (event === 'select') {
    const q = text(input.q, 1, false);
    if (!q || (input.kind !== 'author' && input.kind !== 'to')) return null;
    params.set('q', q);
    params.set('kind', input.kind);
  } else if (event !== 'open') {
    return null;
  }
  return `/_stats/pager?${params}`;
}

export function trackPager(event: PagerEvent, params?: PagerParams) {
  sendEvent(pagerEventUrl(event, params));
}

export const trackPagerOpen = () => trackPager('open');
export const trackPagerProfile = (nick: string) => trackPager('profile', {nick});
export const trackPagerDialog = (nick: string, other: string) => trackPager('dialog', {nick, with: other});

/**
 * Search accounting identical to the author search: a query is recorded after a
 * 1.2 s pause or right before a selection, and the same query is not repeated while
 * the search stays open. Create one recorder per open search; call `type` on every
 * input change, `select` when a nick or addressee is chosen, `close` on unmount.
 */
export function createPagerSearchRecorder(
  send: (event: PagerEvent, params: PagerParams) => void = trackPager,
  timers: {set: (fn: () => void, ms: number) => unknown; clear: (id: unknown) => void} = {
    set: (fn, ms) => window.setTimeout(fn, ms),
    clear: (id) => window.clearTimeout(id as number),
  },
) {
  let pending: {q: string; found: number} | null = null;
  let last = '';
  let timer: unknown = null;
  const cancel = () => {
    if (timer !== null) timers.clear(timer);
    timer = null;
  };
  const flush = () => {
    cancel();
    const current = pending;
    pending = null;
    if (!current) return;
    const q = normalizeEventText(current.q);
    if (q.length < PAGER_MIN_QUERY || q === last) return;
    last = q;
    send('search', {q, found: current.found});
  };
  return {
    type(query: string, found: number) {
      cancel();
      pending = {q: query, found};
      if (normalizeEventText(query).length >= PAGER_MIN_QUERY) timer = timers.set(flush, PAGER_SEARCH_PAUSE_MS);
    },
    select(q: string, kind: PagerSelectKind) {
      flush();
      send('select', {q, kind});
    },
    flush,
    close() {
      cancel();
      pending = null;
    },
  };
}
