import {strict as assert} from 'node:assert';
import {afterEach, test} from 'node:test';
import {sendEvent} from '../src/authorAnalytics.ts';
import {createPagerSearchRecorder, pagerEventUrl, trackPager, type PagerEvent, type PagerParams} from '../src/pagerAnalytics.ts';

const parse = (url: string | null) => {
  assert.ok(url);
  const parsed = new URL(url, 'https://pilot-archive.ru');
  assert.equal(parsed.pathname, '/_stats/pager');
  return Object.fromEntries(parsed.searchParams);
};

const originalWindow = (globalThis as any).window;
const originalFetch = globalThis.fetch;
afterEach(() => {
  (globalThis as any).window = originalWindow;
  globalThis.fetch = originalFetch;
});

function stubBrowser(hostname: string) {
  const calls: [string, RequestInit][] = [];
  (globalThis as any).window = {location: {hostname}};
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push([url, init]);
    throw new Error('network down');
  }) as typeof fetch;
  return calls;
}

test('open, profile and dialog events carry only nicknames', () => {
  assert.deepEqual(parse(pagerEventUrl('open')), {event: 'open'});
  assert.deepEqual(parse(pagerEventUrl('profile', {nick: '  Ёжик\u0007 в   тумане '})), {event: 'profile', nick: 'Ёжик в тумане'});
  assert.deepEqual(parse(pagerEventUrl('dialog', {nick: 'Кот', with: 'Пёс & Ко?'})), {event: 'dialog', nick: 'Кот', with: 'Пёс & Ко?'});
  assert.match(pagerEventUrl('dialog', {nick: 'Кот', with: 'Пёс & Ко?'})!, /with=%D0%9F%D1%91%D1%81\+%26\+%D0%9A%D0%BE%3F$/);
  assert.equal(pagerEventUrl('profile', {nick: '   '}), null);
  assert.equal(pagerEventUrl('dialog', {nick: 'Кот'}), null);
  assert.equal(pagerEventUrl('profile', {nick: 'x'.repeat(121)}), null);
});

test('search accepts two-letter nicks and records empty results; select needs a kind', () => {
  assert.deepEqual(parse(pagerEventUrl('search', {q: ' ЁЖ ', found: 0})), {event: 'search', q: 'ёж', found: '0'});
  assert.equal(parse(pagerEventUrl('search', {q: 'ab', found: 3})).found, '1');
  assert.equal(pagerEventUrl('search', {q: 'a', found: 1}), null);
  assert.equal(pagerEventUrl('search', {q: 'a'.repeat(121), found: 1}), null);
  assert.equal(pagerEventUrl('search', {q: 'ab'}), null);
  assert.deepEqual(parse(pagerEventUrl('select', {q: 'Кот', kind: 'to'})), {event: 'select', q: 'Кот', kind: 'to'});
  assert.equal(pagerEventUrl('select', {q: 'Кот'}), null);
  assert.equal(pagerEventUrl('nope' as PagerEvent), null);
});

test('beacon is sent only on pilot-archive.ru without cookies or referrer, errors ignored', async () => {
  let calls = stubBrowser('localhost');
  trackPager('open');
  sendEvent('/_stats/pager?event=open');
  assert.equal(calls.length, 0);
  calls = stubBrowser('pilot-archive.ru');
  trackPager('profile', {nick: 'Кот'});
  trackPager('profile', {nick: ''});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 1);
  const [url, init] = calls[0];
  assert.equal(url, '/_stats/pager?event=profile&nick=%D0%9A%D0%BE%D1%82');
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.cache, 'no-store');
});

test('search recorder debounces, sends before select and never repeats a query', () => {
  const sent: [PagerEvent, PagerParams][] = [];
  const timers: (() => void)[] = [];
  let delay = 0;
  const recorder = createPagerSearchRecorder((event, params) => sent.push([event, params]), {
    set: (fn, ms) => {
      delay = ms;
      return timers.push(fn) - 1;
    },
    clear: (id) => {
      timers[id as number] = () => {};
    },
  });
  recorder.type('к', 5);
  recorder.type('ко', 2);
  recorder.type('кот', 0);
  assert.equal(delay, 1200);
  timers.at(-1)!();
  assert.deepEqual(sent, [['search', {q: 'кот', found: 0}]]);
  recorder.type('Кот ', 1);
  timers.at(-1)!();
  assert.equal(sent.length, 1);
  recorder.type('ёж', 1);
  recorder.select('Ёжик', 'author');
  timers.at(-1)!();
  assert.deepEqual(sent.slice(1), [['search', {q: 'ёж', found: 1}], ['select', {q: 'Ёжик', kind: 'author'}]]);
  recorder.type('пёс', 1);
  recorder.close();
  timers.at(-1)!();
  assert.equal(sent.length, 3);
});
