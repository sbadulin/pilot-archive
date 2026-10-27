import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {authorEventUrl, trackAdultConfirmed} from '../src/authorAnalytics.ts';

test('search events normalize names and record empty results without identifiers', () => {
  const url = new URL(authorEventUrl('search', '  Князь   Тишины ', 0)!, 'https://pilot-archive.ru');
  assert.equal(url.pathname, '/_stats/author');
  assert.deepEqual(Object.fromEntries(url.searchParams), {event: 'search', q: 'князь тишины', found: '0'});
});

test('rejects short or oversized input and distinguishes selecting an author', () => {
  assert.equal(authorEventUrl('search', 'аб', 0), null);
  assert.equal(authorEventUrl('search', 'a'.repeat(121), 1), null);
  const url = new URL(authorEventUrl('select', 'Автор')!, 'https://pilot-archive.ru');
  assert.equal(url.searchParams.get('event'), 'select');
  assert.equal(url.searchParams.has('found'), false);
});

test('18+ confirmation is sent only from the public site, without cookies or Referer', async () => {
  const calls: [string, RequestInit | undefined][] = [];
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved = {window: globals.window, fetch: globals.fetch};
  globals.fetch = async (url: string, init?: RequestInit) => { calls.push([url, init]); throw new Error('offline'); };
  try {
    globals.window = {location: {hostname: 'pilot-archive.pages.dev'}};
    trackAdultConfirmed();
    assert.equal(calls.length, 0);
    globals.window = {location: {hostname: 'pilot-archive.ru'}};
    trackAdultConfirmed();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], '/_stats/adult');
    assert.equal(calls[0][1]?.credentials, 'omit');
    assert.equal(calls[0][1]?.referrerPolicy, 'no-referrer');
  } finally {
    globals.window = saved.window;
    globals.fetch = saved.fetch;
  }
});
