import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPagerSite, messageWhere, type PublicPagerMessage } from '../src/pagerSite.ts';
import {
  addressedTo,
  articlesOf,
  dialogsOf,
  excerptFor,
  isSearchableAddressee,
  mentionsOf,
  monthLabel,
  pagerHash,
  pagerSearchIndex,
  parsePagerRoute,
  preparePager,
  profileOf,
  searchPager,
} from '../src/pagerFeed.ts';

const at = (n: number, from: string | null, to: string[], text: string, extra: Partial<PublicPagerMessage> = {}): PublicPagerMessage => ({
  id: `2000-0${Math.ceil(n / 3)}-006${Math.ceil(n / 3)}-p9-${n}`,
  year: 2000,
  number: `0${Math.ceil(n / 3)}`,
  serial: `006${Math.ceil(n / 3)}`,
  date: `2000-0${Math.ceil(n / 3)}-0${(n % 3) + 1}`,
  sheet: 9,
  from,
  to,
  text,
  ...extra,
});

const rules = {
  aliases: { 'Умиротворенный BAD': 'BAD' },
  joint: { 'Kurt & Kurtочк@': ['Kurt', 'Kurtочк@'] },
  shared: ['Киса'],
};

const fixture: PublicPagerMessage[] = [
  at(1, 'BAD', ['Kurt'], 'Kurt, как-нибудь встретимся.'),
  at(2, 'Kurt', ['BAD'], 'BAD, жду в пятницу.'),
  at(3, 'Bad Girl', ['Пилоты'], 'Bad Girl вернулась!'),
  at(4, 'Марька', ['Анюта', 'BAD'], 'Приветик Анюте и BADy.'),
  at(5, 'Kurt & Kurtочк@', ['всем'], 'Привет от нас двоих.'),
  at(6, 'Киса', ['Лена'], 'Лена, привет!'),
  at(7, 'Умиротворенный BAD', ['Настя Никонова'], 'Настя, спасибо.'),
  at(8, 'Soratnik', [], 'Атака в лице BAD`a!'),
  at(9, 'Hidden', [], 'Задержано цензурой.', { hold: true }),
  at(10, 'Retold', [], '[пересказ] Кто-то кому-то что-то.'),
  at(11, 'Soratnik', ['Bad Boy'], 'Bad Boy, ты где?'),
  at(12, 'Bad Boy', [], 'Я тут.'),
];

const authors = {
  names: [
    { key: 'ваd', keys: ['ваd'], credits: [{ issue: '2000-02-0062', page: 13, kind: 'article', title: 'ОДИН' }, { issue: '2000-02-0062', page: 13, kind: 'article', title: 'ОДИН' }] },
    { key: 'кurт', keys: ['кurт'], credits: [{ issue: '2000-03-0063', page: 2, kind: 'pager', title: null }] },
  ],
};

const { site, stats } = buildPagerSite(fixture, rules, authors);
const model = preparePager(site);
const key = (name: string) => profileOf(model, name)!;

test('held and retold messages never reach the site', () => {
  assert.equal(stats.total, 12);
  assert.deepEqual(stats.dropped, { hold: 1, retold: 1 });
  assert.equal(site.messages.length, 10);
  assert.ok(!site.messages.some((message) => message.text.includes('пересказ') || message.text.includes('цензурой')));
  assert.ok(!site.profiles.some((profile) => ['Hidden', 'Retold'].includes(profile.name)));
});

test('only unique nicks get profiles; shared and first names do not', () => {
  const names = site.profiles.map((profile) => profile.name).sort();
  assert.deepEqual(names, ['BAD', 'Bad Boy', 'Bad Girl', 'Kurt', 'Kurtочк@', 'Soratnik']);
  assert.equal(site.messages.find((message) => message.from === 'Киса')!.nicks, undefined);
  assert.equal(site.messages.find((message) => message.from === 'Марька')!.nicks, undefined);
});

test('an alias goes to its nick, a joint signature to every author', () => {
  const bad = site.profiles.find((profile) => profile.name === 'BAD')!;
  assert.deepEqual(bad.spellings, ['Умиротворенный BAD']);
  assert.equal(bad.messages, 2);
  assert.deepEqual(site.messages.find((message) => message.from === 'Умиротворенный BAD')!.nicks, [bad.key]);
  assert.deepEqual(site.messages.find((message) => message.from === 'Kurt & Kurtочк@')!.nicks, [key('Kurt'), key('Kurtочк@')]);
});

test('articles come from the authors index by key, without duplicates and pager credits', () => {
  const bad = site.profiles.find((profile) => profile.name === 'BAD')!;
  assert.deepEqual(bad.articles, [{ issue: '2000-02-0062', page: 13, kind: 'article', title: 'ОДИН' }]);
  assert.deepEqual(site.profiles.find((profile) => profile.name === 'Kurt')!.articles, []);
  assert.equal(stats.withArticles, 1);
});

test("a profile's articles reach the view model, found by its route name", () => {
  for (const name of ['BAD', 'bad', 'Умиротворенный BAD']) {
    assert.deepEqual(articlesOf(model, profileOf(model, name)!), [{ issue: '2000-02-0062', page: 13, kind: 'article', title: 'ОДИН' }], name);
  }
  assert.deepEqual(articlesOf(model, key('Kurt')), []);
});

test('issue, sheet and date are read back from the id', () => {
  assert.deepEqual(messageWhere('2000-01-0066-p12-3'), { issue: '2000-01-0066', sheet: 12 });
  const first = model.messages[0];
  assert.equal(first.issue, '2000-01-0061');
  assert.equal(first.sheet, 9);
  assert.equal(first.date, site.dates['2000-01-0061']);
  assert.ok(model.messages.every((message, i) => i === 0 || model.messages[i - 1].date <= message.date));
});

test('mentions: addressed or named, never own, longer nicks cut out first', () => {
  const texts = mentionsOf(model, key('BAD')).map((message) => message.text);
  assert.ok(texts.includes('BAD, жду в пятницу.'));
  assert.ok(texts.includes('Приветик Анюте и BADy.'), 'an ending still matches');
  assert.ok(texts.includes('Атака в лице BAD`a!'));
  assert.ok(!texts.includes('Bad Girl вернулась!'), 'Bad Girl is another nick');
  assert.ok(!texts.includes('Bad Boy, ты где?'), 'Bad Boy is another nick');
  assert.ok(!texts.some((text) => text.startsWith('Kurt, как-нибудь')), 'own messages are not mentions');
});

test('dialogs group by counterpart, two-sided first', () => {
  const dialogs = dialogsOf(model, key('BAD'));
  assert.equal(dialogs[0].other, key('Kurt'));
  assert.deepEqual([dialogs[0].mine, dialogs[0].theirs], [1, 1]);
  assert.deepEqual(dialogs.map((dialog) => model.profiles.get(dialog.other)!.name), ['Kurt', 'Soratnik']);
  // Марька has no profile: her greeting is a mention, not a dialog.
  assert.ok(!dialogs.some((dialog) => dialog.messages.some((message) => message.from === 'Марька')));
});

test('routes parse and format', () => {
  assert.equal(parsePagerRoute('#archive'), null);
  assert.equal(parsePagerRoute('#pagers'), null);
  assert.deepEqual(parsePagerRoute('#pager'), { nick: null, tab: 'own', with: null });
  assert.deepEqual(parsePagerRoute('#pager/BAD'), { nick: 'BAD', tab: 'own', with: null });
  assert.deepEqual(parsePagerRoute('#pager/BAD/about'), { nick: 'BAD', tab: 'about', with: null });
  assert.deepEqual(parsePagerRoute('#pager/Kurt%D0%BE%D1%87%D0%BA%40/dialogs/BAD'), { nick: 'Kurtочк@', tab: 'dialogs', with: 'BAD' });
  assert.deepEqual(parsePagerRoute('#pager/BAD/nonsense'), { nick: 'BAD', tab: 'own', with: null });
  assert.deepEqual(parsePagerRoute('#pager/%E0%A4%A'), { nick: null, tab: 'own', with: null });
  for (const hash of ['#pager', '#pager/BAD', '#pager/BAD/articles', '#pager/Kurt%D0%BE%D1%87%D0%BA%40/dialogs/Bad%20Girl']) {
    const route = parsePagerRoute(hash)!;
    assert.equal(pagerHash(route.nick, route.tab, route.with), hash);
  }
  assert.equal(pagerHash('A/B'), '#pager/A%2FB');
});

test('search: nicks open profiles, addressees filter, real names are not searchable', () => {
  const index = pagerSearchIndex(model);
  const hits = searchPager(index, 'bad');
  assert.equal(hits[0].name, 'BAD');
  assert.deepEqual(hits.map((hit) => hit.kind), ['author', 'author', 'author']);
  assert.deepEqual(searchPager(index, 'b'), []);
  assert.deepEqual(searchPager(index, 'настя'), [], '«Настя Никонова» is a real name');
  assert.ok(!isSearchableAddressee('Настя Никонова'));
  assert.ok(isSearchableAddressee('всем'));
  const all = searchPager(index, 'всем');
  assert.deepEqual(all.map((hit) => [hit.kind, hit.name]), [['to', 'всем']]);
  assert.equal(addressedTo(model, all[0].key).length, 1);
  // An addressee that is a nick is found as the nick, not as an addressee.
  assert.ok(!index.some((hit) => hit.kind === 'to' && hit.name === 'Kurt'));
});

test('month headings start with a capital letter', () => {
  assert.equal(monthLabel('2000-03'), 'Март 2000');
});

test('a dialog shows only the part of a message addressed to the other side', () => {
  const messages: PublicPagerMessage[] = [
    at(1, 'Спорти', ['F@d', 'BAD'], 'F@d, ты не ответил. Испугался? BAD, с днем, что ли?'),
    at(2, 'Туса', ['BAD'], 'Bad, не ты ль стоял на граффити позади меня?'),
    at(3, 'BAD', ['Вася Хмурый', 'Туса', 'Спорти'], 'Вася Хмурый! Пусть тебя мама родит обратно. Туса, я там везде стоял (в кепке с черепушкой). Спорти! Томас Манн весьма кстати.'),
    at(4, 'BAD', ['Спорти'], 'Спорти, привет.'),
    at(5, 'Туса', ['BAD', 'Rat'], 'Огромные извинения и большое спасибо BADy, Rat и Хавчу. Такого больше не повторится.'),
  ];
  const small = preparePager(buildPagerSite(messages, {}, { names: [] }).site);
  const bad = profileOf(small, 'BAD')!;
  const sporti = profileOf(small, 'Спорти')!;
  const tusa = profileOf(small, 'Туса')!;
  const byId = new Map(small.messages.map((m) => [m.id, m]));
  const third = byId.get(messages[2].id)!;
  assert.equal(excerptFor(small, third, sporti), 'Спорти! Томас Манн весьма кстати.');
  assert.equal(excerptFor(small, third, tusa), 'Туса, я там везде стоял (в кепке с черепушкой).');
  assert.equal(excerptFor(small, byId.get(messages[0].id)!, bad), 'BAD, с днем, что ли?');
  // The whole message is addressed to the other side: nothing to cut.
  assert.equal(excerptFor(small, byId.get(messages[3].id)!, sporti), null);
  assert.equal(excerptFor(small, byId.get(messages[1].id)!, bad), null);
  // A nick in the middle of a sentence («спасибо BADy, Rat и Хавчу») isn't a greeting: show it all.
  assert.equal(excerptFor(small, byId.get(messages[4].id)!, bad), null);
});
