// Events go only to the Russian site's Caddy log. No cookies or persistent IDs.
export type AuthorEvent = 'search' | 'select';

export const adultEventUrl = '/_stats/adult';

export const MAX_EVENT_TEXT = 120;

// NFC, control characters to spaces, collapsed whitespace. Lowercased when `lower`.
export function normalizeEventText(value: string, lower = true): string {
  const text = value.normalize('NFC').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ');
  return lower ? text.toLocaleLowerCase('ru') : text;
}

export function authorEventUrl(event: AuthorEvent, value: string, results?: number): string | null {
  const query = normalizeEventText(value);
  if (query.length < (event === 'search' ? 3 : 1) || query.length > MAX_EVENT_TEXT) return null;
  const params = new URLSearchParams({event, q: query});
  if (event === 'search' && results !== undefined) params.set('found', results > 0 ? '1' : '0');
  return `/_stats/author?${params}`;
}

// Shared by the author, 18+ and pager beacons (src/pagerAnalytics.ts).
export function sendEvent(url: string | null) {
  if (window.location.hostname !== 'pilot-archive.ru' || !url) return;
  void fetch(url, {credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', keepalive: true}).catch(() => {});
}

export function trackAuthor(event: AuthorEvent, value: string, results?: number) {
  sendEvent(authorEventUrl(event, value, results));
}

// Sent once, when the reader confirms the 18+ notice; the browser then remembers the choice.
export function trackAdultConfirmed() {
  sendEvent(adultEventUrl);
}
