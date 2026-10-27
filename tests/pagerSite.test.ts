import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPagerSite, messageWhere, type PublicPagerMessage } from '../src/pagerSite.ts';
import { pagerPath, pagerRouteOf, readableUrl } from '../src/pagerRoute.ts';
import { withAdjectives } from '../src/pagerNicks.ts';
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
  remarksOf,
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
  assert.deepEqual(stats.dropped, { hold: 1, retold: 1, duplicate: 0, editorial: 0 });
  assert.equal(site.messages.length, 10);
  assert.ok(!site.messages.some((message) => message.text.includes('пересказ') || message.text.includes('цензурой')));
  assert.ok(!site.profiles.some((profile) => ['Hidden', 'Retold'].includes(profile.name)));
});

test('editorial texts and running headers never reach the site', () => {
  const contest = at(13, null, [], 'УЧАСТВУЮТ ВСЕ, КТО ПОЖЕЛАЕТ – ШКОЛЬНИКИ, СТУДЕНТЫ…');
  const header = at(14, null, [], '12\n\n«ПП» • 5 апреля 2000 года, среда, № 14 (0079)');
  const poem = at(15, null, [], '12 строк о любви • без подписи');
  const built = buildPagerSite([...fixture, contest, header, poem], rules, authors, { exclude: { [contest.id]: 'конкурс' } });
  assert.equal(built.stats.dropped.editorial, 2);
  assert.ok(!built.site.messages.some((message) => message.id === contest.id || message.id === header.id));
  assert.ok(built.site.messages.some((message) => message.id === poem.id), 'an unsigned reader text stays');
});

test('links name the printed page: a spread before the sheet shifts it, a spread sheet gets two numbers', () => {
  const page = (sheet: number, n: number): PublicPagerMessage =>
    ({ id: `2000-01-0066-p${sheet}-${n}`, year: 2000, number: '01', serial: '0066', date: '2000-01-05', sheet, from: 'BAD', to: [], text: `Сообщение ${n}.` });
  const spreads = { '2000-01-0066': [8], '2000-02-0067': [3] };
  const built = buildPagerSite([page(5, 1), page(8, 2), page(12, 3)], rules, authors, { spreads });
  assert.deepEqual(built.site.spreads, { '2000-01-0066': [8] }, 'only issues shown in the feed');
  const where = preparePager(built.site).messages.map(({ sheet, page, pages }) => ({ sheet, page, pages }));
  assert.deepEqual(where, [
    { sheet: 5, page: 5, pages: '5' },
    { sheet: 8, page: 8, pages: '8–9' },
    { sheet: 12, page: 13, pages: '13' },
  ]);
  assert.equal(model.messages[0].page, model.messages[0].sheet, 'no spreads, no shift');
});

test('search examples are only names that open a profile', () => {
  assert.deepEqual(model.featured, []);
  assert.deepEqual(preparePager({ ...site, featured: ['BAD', 'Киса', 'Нет такого'] }).featured, ['BAD']);
});

test('a message recognized twice on one page is shown once; reprints and other ads stay', () => {
  const page = (n: number, from: string, text: string): PublicPagerMessage =>
    ({ id: `2000-34-0099-p11-${n}`, year: 2000, number: '34', serial: '0099', date: '2000-08-23', sheet: 11, from, to: [], text });
  const { site, stats } = buildPagerSite([
    page(1, 'Спорти', 'МЕС! Вот зачем тебе со мной знакомиться? Ну что мы будем делать, если не понравимся друг другу, а, если понравимся?'),
    page(2, 'Спорти', 'Мес! Вот зачем тебе со мной знакомиться? Ну что мы будем делать, если не понравимся друг другу? А если понравимся?'),
    page(3, 'Девушки из шоу', '33. Ребята, которые хотели познакомиться 10.07 на Амуре с нами. Ждем вас 21.07.'),
    page(4, 'Девушки из шоу', '123. Ребята, которые хотели познакомиться с нами 10.07 на Амуре. Ждем вас 21.07.'),
    page(5, 'Аноним', 'М-277 Привет обаятельным девушкам 17-23 лет. Хотите познакомиться?'),
    page(6, 'Аноним', 'М-278. Привет обаятельным девушкам 17-23 лет. Хотите познакомиться?'),
    page(7, 'Милли', 'Веселая и прикольная девчонка хочет познакомиться с прикольными девчонками. Мне 14 лет.'),
    page(8, 'Помэлла', 'Веселая и прикольная девчонка хочет познакомиться с прикольными девчонками. Мне 13 лет.'),
  ], {}, { names: [] });
  assert.equal(stats.dropped.duplicate, 1);
  assert.deepEqual(site.messages.map((message) => message.id.split('-').pop()), ['1', '3', '4', '5', '6', '7', '8']);
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
  assert.deepEqual(site.profiles.find((profile) => profile.name === 'Kurt')!.spellings, [], 'a joint signature is not a spelling');
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
  for (const hash of ['#pager', '#pager/BAD', '#pager/BAD/articles', '#pager/Kurtочк@/dialogs/Bad%20Girl', '#pager/Спорти/dialogs/ICEPAC']) {
    const route = parsePagerRoute(hash)!;
    assert.equal(pagerHash(route.nick, route.tab, route.with), hash);
  }
  // Links stay readable: Cyrillic and @ as they are, only what breaks a link is encoded.
  assert.equal(pagerHash('Спорти'), '#pager/Спорти');
  assert.equal(pagerHash('A/B'), '#pager/A%2FB');
  assert.equal(pagerHash('50%#?'), '#pager/50%25%23%3F');
  // Old encoded links still open.
  assert.deepEqual(parsePagerRoute('#pager/%D0%A1%D0%BF%D0%BE%D1%80%D1%82%D0%B8'), { nick: 'Спорти', tab: 'own', with: null });
});

test('the section lives at /pager; an old #pager link and a hash link opened from it still work', () => {
  assert.equal(pagerPath(), '/pager');
  assert.equal(pagerPath('Спорти', 'dialogs', 'Bad Girl'), '/pager/Спорти/dialogs/Bad%20Girl');
  // The browser gives the path percent-encoded.
  assert.deepEqual(pagerRouteOf('/pager/%D0%A1%D0%BF%D0%BE%D1%80%D1%82%D0%B8/about', ''), { nick: 'Спорти', tab: 'about', with: null });
  assert.deepEqual(pagerRouteOf('/pager/', ''), { nick: null, tab: 'own', with: null });
  assert.deepEqual(pagerRouteOf('/', '#pager/BAD'), { nick: 'BAD', tab: 'own', with: null });
  assert.equal(pagerRouteOf('/pager/BAD', '#issue-2000-01-0066-p13'), null, 'an issue opened from the section');
  assert.equal(pagerRouteOf('/pagers', ''), null);
  assert.equal(pagerRouteOf('/', ''), null);
  assert.deepEqual(parsePagerRoute('#pager/Спорти'), { nick: 'Спорти', tab: 'own', with: null });
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
  // A «P.S.» opening the next greeting stays with it, not dangling at the end of this part.
  const ps = preparePager(buildPagerSite([
    at(1, 'Спорти', ['МЕС', 'ПТ'], 'МЕС! Вот зачем тебе со мной знакомиться? А если понравимся?\n\nP.S. ПТ, спасибо за заботу.'),
    at(2, 'МЕС', ['Спорти'], 'Спорти, познакомимся?'),
    at(3, 'ПТ', ['Спорти'], 'Спорти, пожалуйста.'),
  ], {}, { names: [] }).site);
  const fromSporti = ps.messages.find((message) => message.from === 'Спорти')!;
  assert.equal(excerptFor(ps, fromSporti, profileOf(ps, 'МЕС')!), 'МЕС! Вот зачем тебе со мной знакомиться? А если понравимся?');
  // A nick in the middle of a sentence («спасибо BADy, Rat и Хавчу») isn't a greeting: show it all.
  assert.equal(excerptFor(small, byId.get(messages[4].id)!, bad), null);
});

test('a copied link reads as letters, but spaces and escapes stay encoded', () => {
  const live = `https://pilot-archive.ru/#${encodeURI('pager/Спорти')}`;
  assert.equal(readableUrl(live), 'https://pilot-archive.ru/#pager/Спорти');
  const dialog = `https://pilot-archive.ru/${encodeURI(pagerHash('Dat Nigga Daz', 'dialogs', 'Тори')).replace(/%25/g, '%')}`;
  assert.equal(readableUrl(dialog), 'https://pilot-archive.ru/#pager/Dat%20Nigga%20Daz/dialogs/Тори');
  assert.equal(readableUrl('https://pilot-archive.ru/#pager/100%25%20%D0%AF'), 'https://pilot-archive.ru/#pager/100%25%20Я');
  assert.equal(readableUrl('https://x/#%D0'), 'https://x/#%D0', 'a broken sequence is left as is');
});

test('a nick that holds another one anywhere, or a signature repeated in the text, is not a mention', () => {
  const pasha = at(1, 'Пашк.A not Bad', ['Killer'], 'Killer – это обезболивающее? Весь Metal и Punk! Пашк.A not Bad.');
  const about = at(2, 'Soratnik', [], 'Привет Пашк.A not Bad!');
  const loner = at(3, 'Ну и что, что not Bad', [], 'Я сам по себе. Ну и что, что not Bad');
  const real = at(4, 'Kurt', [], 'BAD, ты где?');
  const own = at(5, 'BAD', [], 'Я тут.');
  // Adjectives before the nick are the same person, signed or named in a text.
  const sleepy = at(6, 'Сонный BAD', [], 'Всем спать. Сонный BAD.');
  const named = at(7, 'Kurt', [], 'Привет Сонному... нет, Сонный BAD, привет!');
  const built = preparePager(buildPagerSite([pasha, about, loner, real, own, sleepy, named], rules, authors).site);
  const texts = mentionsOf(built, profileOf(built, 'BAD')!).map((message) => message.text);
  assert.deepEqual(texts.sort(), [real.text, sleepy.text, named.text].sort());
});

test('a remark in brackets in another message is the profile\'s comment, not a mention', () => {
  const remark = at(1, 'Наташа Б', [], 'Около Раисполкома (будет политинформация? – ПТ) на крыльце. Приди!');
  const addressed = at(2, '$aucy Kitten', [], 'Рыженький (ПТ), приветище!!!');
  const own = at(3, 'ПТ', [], 'Уже начал!');
  const reader = at(4, 'Svetk@', [], 'Пишу сама.');
  const quoted = at(5, 'Kurt', [], 'Привет школе (ура! – Svetk@)!');
  const built = preparePager(buildPagerSite([remark, addressed, own, reader, quoted], { ...rules, staff: ['ПТ'] }, authors).site);
  const pt = profileOf(built, 'ПТ')!;
  assert.equal(built.profiles.get(pt)!.staff, true);
  assert.deepEqual(remarksOf(built, pt).map((message) => message.text), [remark.text]);
  assert.deepEqual(mentionsOf(built, pt).map((message) => message.text), [addressed.text]);
  assert.deepEqual(remarksOf(built, profileOf(built, 'Svetk@')!), [], 'only the editorial has remarks');
  assert.deepEqual(parsePagerRoute('#pager/ПТ/remarks'), { nick: 'ПТ', tab: 'remarks', with: null });
  assert.equal(profileOf(built, 'Рыженький (ПТ)'), pt, 'the nick in brackets');
  assert.equal(profileOf(model, 'Дима (г. Комсомольск)'), null, 'a town in brackets is not a nick');
});

test('an alias never signed still finds the profile as an addressee', () => {
  const own = at(1, 'ТТ', [], 'Привет всем!');
  const to = at(2, 'Kurt', ['Т.Т.'], 'Т.Т., спасибо за ответ!');
  const built = buildPagerSite([own, to], { ...rules, aliases: { ...rules.aliases, 'Т.Т.': 'ТТ' } }, authors).site;
  const tt = built.profiles.find((profile) => profile.name === 'ТТ')!;
  assert.deepEqual([tt.aka, tt.spellings], [['Т.Т.'], []]);
  const ready = preparePager(built);
  assert.equal(profileOf(ready, 'Т.Т.'), tt.key);
  assert.deepEqual(mentionsOf(ready, tt.key).map((message) => message.text), [to.text]);
});

test("a nick's bylines in the newspaper bring their articles", () => {
  const own = at(1, 'ПТ', [], 'Уже начал!');
  const index = { names: [{ key: 'павел трутнев', credits: [{ issue: '2000-31-0096', page: 3, kind: 'article', title: 'Кино' }] }] };
  const built = buildPagerSite([own], { ...rules, writers: { ПТ: ['Павел ТРУТНЕВ'] } }, index).site;
  const pt = built.profiles.find((profile) => profile.name === 'ПТ')!;
  assert.deepEqual(pt.bylines, ['Павел ТРУТНЕВ']);
  assert.deepEqual(pt.articles.map((article) => article.title), ['Кино']);
});

test('adjectives before a nick describe the same person', () => {
  assert.ok(withAdjectives('Умиротворенный BAD', 'BAD'));
  assert.ok(withAdjectives('Мелированный Виталя Мэнсон', 'Виталя Мэнсон'));
  assert.ok(!withAdjectives('Пашк.A not Bad', 'BAD'));
  assert.ok(!withAdjectives('BAD', 'BAD'));
  assert.ok(withAdjectives('Ваша LEXX', 'Lexx'), 'a possessive');
  assert.ok(withAdjectives('Всегда ваша верная Лёля', 'Лёля'));
  assert.ok(!withAdjectives('Другой Kurdt', 'Kurdt'), '«другой» is someone else');
  assert.ok(!withAdjectives('Подруга Kurt', 'Kurt'), 'a relation is someone else');
});
