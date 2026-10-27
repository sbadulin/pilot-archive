import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKER,
  accepted,
  align,
  applySpans,
  censorAlso,
  closedWordsOf,
  messageId,
  nameSpans,
  parseWords,
  percentRect,
  queryFromPhrase,
  queryFromWords,
  splitArticles,
  stemSpans,
  tokenize,
  wordsUnderBox,
} from '../src/pager.ts';
import { buildNicks, classifyNick, nickKey, profileCandidates } from '../src/pagerNicks.ts';

const filler = (n: number) => Array.from({ length: n }, (_, i) => `● Привет, номер ${i}! Это довольно длинное сообщение, чтобы колонка вышла большой. Лена ${i}.`).join('\n\n');

test('a glued column with bullets is split into messages, continuation joins the previous one', () => {
  const pieces = splitArticles([
    { text: filler(12) },
    { text: `продолжение без маркера. Хвост.\n\n${filler(12)}` },
  ]);
  assert.equal(pieces.length, 24);
  assert.ok(pieces[11].text.endsWith('продолжение без маркера. Хвост.'));
  assert.ok(!pieces[0].text.startsWith('●'));
  assert.equal(pieces[12].article, 1);
});

test('numbered columns keep the printed number as seq', () => {
  const text = Array.from({ length: 8 }, (_, i) => `${84 + i}. Сообщение под номером ${84 + i}, достаточно длинное для склейки колонки. ПТ.`).join('\n\n') + '\n\nпродолжение восьмого.';
  const pieces = splitArticles([{ title: 'Комсомольск-на-Амуре', text: text + ' '.repeat(400) }]);
  assert.deepEqual(pieces.map(piece => piece.seq), [84, 85, 86, 87, 88, 89, 90, 91]);
  assert.equal(pieces[0].title, 'Комсомольск-на-Амуре');
  assert.ok(pieces[7].text.endsWith('продолжение восьмого.'));
});

test('editorial pieces with a title stay whole; short messages are untouched', () => {
  const editorial = { title: 'Девочка-тинейджер, позвони на пейджер!!!', text: filler(15) };
  assert.equal(splitArticles([editorial]).length, 1);
  const pieces = splitArticles([{ text: 'Маша, привет! Егор.' }, { title: '220.', text: 'Ещё одно. Лена.' }, { text: '  ' }]);
  assert.equal(pieces.length, 2);
  assert.equal(pieces[1].seq, 220);
  assert.equal(pieces[1].title, null);
});

test('message ids are stable strings per issue, sheet and position', () => {
  assert.equal(messageId({ year: 2000, number: '22', serial: '0087' }, 9, 14), '2000-22-0087-p9-14');
});

const tsv = [
  'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext',
  '1\t1\t0\t0\t0\t0\t0\t0\t1000\t2000\t-1\t',
  ...[
    ['Пишите', 100, 100, 80],
    ['мне:', 190, 100, 50],
    ['ул.', 250, 100, 30],
    ['Пионерская,', 290, 100, 120],
    ['14-', 420, 100, 30],
    ['9.', 100, 130, 20],
    ['Таня.', 130, 130, 60],
  ].map(([text, left, top, width]) => `5\t1\t3\t1\t1\t1\t${left}\t${top}\t${width}\t25\t96\t${text}`),
].join('\n');

test('words under a box are recovered and located in the message text', () => {
  const page = parseWords(tsv);
  assert.equal(page.width, 1000);
  const box = percentRect(page, [24, 4.9, 46, 6.4]);
  const covered = new Set(wordsUnderBox(page, box));
  assert.deepEqual([...covered].map(i => page.words[i].raw), ['ул.', 'Пионерская,', '14-']);
  const query = queryFromWords(page.words, covered);
  // Перенос «14-» / «9.» склеен в одно слово, закрытое целиком.
  assert.deepEqual(query.filter(token => token.covered).map(token => token.norm), ['ул', 'пионерская', '14-9']);
  const text = 'Таня из СШ 5 ищет друзей! Пишите мне: ул. Пионерская, 14-9. Таня.';
  const tokens = tokenize(text);
  const found = align(query, tokens);
  assert.ok(accepted(found));
  const span = { start: tokens[found.first].start, end: tokens[found.last].end };
  assert.equal(text.slice(span.start, span.end), 'ул. Пионерская, 14-9');
});

test('find phrases match despite OCR differences, numbers only exactly', () => {
  const tokens = tokenize('Звоните 4-50-22! Ваша Ксю.');
  assert.ok(accepted(align(queryFromPhrase('4-50-22!'), tokens)));
  assert.ok(!accepted(align(queryFromPhrase('4-50-23'), tokens)));
  const words = tokenize('Пр. Ленина, 40, кв. 55 — мой адрес');
  const found = align(queryFromPhrase('Пр.Ленипа, 40, кв. 55'), words);
  assert.ok(accepted(found));
  assert.equal(found.first, 0);
});

test('redaction spans are merged and replaced by one marker', () => {
  const text = 'Я живу на ул. Мира, 10. Пиши!';
  const out = applySpans(text, [{ start: 10, end: 13 }, { start: 14, end: 18 }, { start: 20, end: 22 }]);
  assert.equal(out, `Я живу на ${MARKER}. Пиши!`);
});

test('the name rule closes the surname with first name and initials', () => {
  const text = 'Выбрали В. В. Путина, а Владимир Путин молчит; путина лосося идёт.';
  const out = applySpans(text, nameSpans(text, 'Путин'));
  assert.equal(out, `Выбрали ${MARKER}, а ${MARKER} молчит; путина лосося идёт.`);
});

test('scanner stems close whole words; closed words are closed in signatures too', () => {
  const text = 'Привет всем трансвеститам! Нерусь.';
  const at = text.indexOf('Нерусь');
  const spans = [...stemSpans(text, 'трансвестит'), { start: at, end: at + 'Нерусь'.length }];
  // Между закрытыми словами одни знаки — один маркер.
  assert.equal(applySpans(text, spans), `Привет всем ${MARKER}.`);
  const closed = closedWordsOf(text, spans);
  assert.equal(censorAlso('Нерусь', closed), MARKER);
  assert.equal(censorAlso('Лена', closed), 'Лена');
});

test('nick classes: first names, generic words, real names, editorial and creative nicks', () => {
  for (const name of ['Лена', 'Катя', 'Иринка', 'Ленчик', 'Юля Н', 'Танюха', 'Vitaly']) assert.equal(classifyNick(name), 'firstName', name);
  for (const name of ['Я', 'Мы', 'Незнакомка', 'Твоя Лолита', 'Твой Медвежонок', 'Девушка с характером', 'Те, кого вы не знаете']) assert.equal(classifyNick(name), 'generic', name);
  for (const name of ['ПИЛОТЫ', 'ТТ', 'ПТ']) assert.equal(classifyNick(name), 'editorial', name);
  assert.equal(classifyNick('Настя Никонова'), 'realName');
  assert.equal(classifyNick('Лена, Марина и Лена'), 'group');
  for (const name of ['BAD', 'П@нд@', 'Lexx', 'WerWolf', 'Маузер', 'Безобидная Маньячка', 'Lee-der, г. Амурск', 'Чернокнижник']) assert.equal(classifyNick(name), 'unique', name);
});

test('nicks are merged only by explicit aliases; Bad Girl is someone else', () => {
  const rules = { aliases: { 'Умиротворенный BAD': 'BAD' } };
  assert.notEqual(nickKey('Умиротворенный BAD'), nickKey('BAD'));
  assert.equal(nickKey('Умиротворенный BAD', rules), nickKey('BAD'));
  assert.equal(nickKey('ICEPAC'), nickKey('Icepac'));
  assert.notEqual(nickKey('Bad Girl', rules), nickKey('BAD'));
  const nicks = buildNicks([
    { id: 'a', date: '2000-05-31', from: 'Умиротворенный BAD' },
    { id: 'b', date: '2000-06-14', from: 'BAD.' },
    { id: 'c', date: '2000-06-14', from: 'Bad Girl' },
  ], rules);
  const bad = nicks.find(nick => nick.key === nickKey('BAD'));
  assert.equal(bad?.name, 'BAD');
  assert.equal(bad?.messages, 2);
  assert.equal(bad?.first, '2000-05-31');
  assert.equal(bad?.unique, true);
});

test('similar nicks become profile candidates, not merges; distinct people are left out', () => {
  const messages = ['ICE', 'ICEPAC', 'Ice Pac', 'Icepac', 'Kurt', 'Kurtочк@', 'Растроганный ПТ', 'ПТ'].map((from, i) => ({ id: String(i), date: '2000-01-01', from }));
  const nicks = buildNicks(messages);
  assert.equal(nicks.length, 7);
  const rules = { distinct: [['Kurt', 'Kurtочк@']] };
  const candidates = profileCandidates(nicks, rules);
  const ice = candidates.find(candidate => candidate.names.includes('ICE'));
  assert.deepEqual(new Set(ice?.names.map(name => name.toLowerCase())), new Set(['ice', 'icepac', 'ice pac']));
  assert.ok(!candidates.some(candidate => candidate.names.includes('Kurt')));
  assert.ok(profileCandidates(nicks).some(candidate => candidate.names.includes('Kurt')));
  assert.ok(candidates.some(candidate => candidate.names.includes('Растроганный ПТ') && candidate.names.includes('ПТ')));
});
