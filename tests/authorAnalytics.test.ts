import {strict as assert} from 'node:assert';
import {test} from 'node:test';
import {authorEventUrl} from '../src/authorAnalytics.ts';

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
