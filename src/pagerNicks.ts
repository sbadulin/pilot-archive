// Подписи «Пейджера» → ники. Ник «уникальный», только если по нему можно узнать одного
// человека: не обычное имя («Лена», «Катюша»), не местоимение и не общее слово («Я»,
// «Незнакомка», «Твоя …»), не «Имя Фамилия» и не подпись редакции. Только у уникальных ников
// может быть страница на сайте; адресатов (to) не связываем и не собираем вовсе (152-ФЗ).
import { normalizeName } from './authorNames.ts';

// shared — одна подпись у нескольких читателей («Киса» — пять разных девочек): профиля нет.
export type NickClass = 'unique' | 'firstName' | 'realName' | 'generic' | 'group' | 'editorial' | 'shared';

// Обычные имена и уменьшительные формы, как их подписывают (нижний регистр, «е» вместо «ё»).
const NAMES = new Set(
  `
александр саша саня санек санечка шура шурик алекс алик александра сашенька сашка саша
алексей леша лешка лешик алеша леха лешенька алена аленка аленушка алина
анастасия настя настена настенька настюха настюша ася
анатолий толя толик анатоль
андрей андрюша андрюха андрюшка дрон
анжела анжелика анна аня анюта анечка анька нюра нюша нюта нютка нюрик анюточка
антон антоша антоха арина артем тема темка артемка арсений
богдан борис боря вадим вадик валентин валя валентина валерия лера лерочка валера валерий
варвара варя василий вася василиса вера верочка вероника ника вика викуля виктория викуша
виктор витя витек виталий виталя виталик владимир вова вовка вовчик володя влад владислав
владислава вячеслав слава славик галина галя галочка геннадий гена георгий гоша гриша григорий
дарья даша дашенька дашка денис дениска дэн ден дима димка димон димуля дмитрий диана
евгений евгения женя женечка женька женек жека евгеша егор елена лена леночка ленка ленчик
ленуся ленок аленька елизавета лиза лизочка ирина ира ирка иринка ириша иришка ируся ириха ируна
игорь игорек иван ваня ванька ванечка илья илюша инга инна карина катерина екатерина катя
катюша катенька катька катюха катюшка кирилл кира кристина кристя ксения ксюша ксюха ксюшка
константин костя костик лариса лара лида лидия любовь люба любаша людмила люда люся людочка
максим макс максик маргарита рита марина маринка маришка маришa мариша мария маша машенька
машка машуля машечка маня михаил миша мишка мишаня надежда надя надюша наталья наталия наташа
наташка натали наташенька натка натик никита никитка николай коля колян коленька нина оксана
оксанка ксана оксик олег олежка ольга оля олечка оленька олька ольчик оля-ля павел паша пашка
павлик полина поля петр петя роман рома ромка ромчик руслан светлана света светик светочка
светка сергей сережа серега серый сережка серж семен снежана софья соня станислав стас
стасик степан степа таисия тася таська тамара тома томик тарас татьяна таня танюша танечка
танюха танька танчик тимур тимофей ульяна федор федя фатима эдуард эдик эльвира эля юлия
юля юленька юлька юльчик юляша юлечка юрий юра юрка юрик яна яночка ярослав ярослава
леся лесик лоля ната натаха натик лелик лёлик лелька лешик дарина марго уля улька лина тоня тоська тонечка элен лиля
лика лола нинок нинчик нино рая дина ева кэт кэти мэри энн джейн лева левушка алиса аделина глория линда катарина
настасья николетта памела таша полинка мишель хельга аня-пулеметчица вики ника ник никки ники аллочка алла римма
рита риша эля злата кира кристи крис мила милка милли люба люся янчик яночка снежана диана дианка
ivan alex alexey sasha ann anna annie jane janet helena natali natalie niki nikki viki vika tony danny dan dave
jessy jessica nina lina milly milli rose kate katty kat mary maria olya lesya lena lenochka irisha irishka kristina
alena alyona ksenia ksusha marina sveta svetka dasha nata stasya lena lenа kate katya katia masha natasha olga olya julia yulia vitaly
sergey serge denis dima nastya tanya anna anya irina ira maxim max oksana pasha andrey
`
    .split(/\s+/)
    .filter(Boolean),
);

// Корни имён для уменьшительных форм, которых нет в списке («Ленусик», «Танюшка»).
const ROOTS = [
  'лен', 'кат', 'ир', 'тан', 'ол', 'юл', 'мар', 'маш', 'наст', 'дим', 'саш', 'сан', 'серг', 'сер', 'алек', 'жен',
  'ан', 'нат', 'свет', 'ксю', 'вик', 'даш', 'паш', 'леш', 'макс', 'ден', 'ром', 'вов', 'кол', 'миш', 'тол', 'люд',
  'люб', 'вал', 'гал', 'над', 'вер', 'окс', 'инн', 'лар', 'юр', 'стас', 'вад', 'тем', 'кир', 'ван', 'пет', 'кост',
  'слав', 'гош', 'гриш', 'тас', 'том', 'лиз', 'сон', 'вит', 'руд', 'ал',
];
const DIMINUTIVE = /(?:ечка|очка|ичка|енька|онька|юшка|ушка|юша|уша|уля|уся|юся|усик|юсик|ечек|очек|чик|чок|ик|ок|ек|ка|ша|ня|ля|ся|ха|юха|уха|ена|ена|ик)$/u;

// Местоимения, родство, общие слова и связки, из которых складываются неуникальные подписи.
const GENERIC = new Set(
  `
я мы ты вы он она они оно кто некто никто ктото кто-то сам сама сами
твой твоя твое твои ваш ваша ваше ваши мой моя мои наш наша наши свой своя
просто всегда навеки вечно любящая любящий любимая любимый с со и или от из для в на а же еще
любовью приветом уважением целую
незнакомка незнакомец незнакомая незнакомый незнакомые незнакомки знакомка знакомая знакомый знакомые
аноним анонимка анонимно инкогнито угадай угадайте догадайся отгадай знаешь сама-знаешь
подруга подруги подружка подружки друг друзья другом подругой
девушка девушки девчонка девчонки девочка девочки парень парни пацан пацаны мальчик мальчики
мама мамуля папа сестра сестренка брат братишка бабушка дедушка тетя дядя сын дочь дочка семья родители родные
одноклассница одноклассник одноклассники одноклассницы ученица ученик ученики
поклонник поклонница поклонники обожатель обожательница влюбленный влюбленная влюбленные
та тот те та-самая тот-самый самая самый который которая которые кого кому тебя тебе
бывшая бывший будущая будущий старый старая новая новый
класс школа сш шк лицей гимназия г город поселок пос
все всем всех
без подписи подпись аноним анонимный
киса киска киски котенок котенка котик котя кот кошка кошечка зайка зайки зайчик зайчонок малышка малыш крошка
солнышко куколка звездочка мышка мышонок милашка очаровашка лапочка рыбка ласточка ангелочек
доброжелатель доброжелательница доброжелательницы последователь невеста жених студент студентка одинокая одинокий
молодая молодой мечтательница зеленоглазая голубоглазая блондинка брюнетка девчонки мальчишки серёги сереги трое двое
girl boy baby kiss kitty angel friend dj
`
    .split(/\s+/)
    .filter(Boolean),
);

// Подписи самой редакции: не читатели.
const EDITORIAL = new Set(['пилоты', 'пилот', 'пп', 'тт', 'пт', 'п т', 'редакция', 'редактор', 'наборщик', 'почтальон п', 'ваши пилоты', 'ваши братья пилоты', 'братья пилоты']);

const SURNAME = /(?:ов|ев|ёв|ин|ын|ова|ева|ёва|ина|ына|ский|ская|цкий|цкая|енко|ко|ук|юк|ич|ых|их|ян|дзе|швили)$/u;

const lower = (word: string) => normalizeName(word);

export const isFirstName = (word: string): boolean => {
  const w = lower(word).replace(/\s+/g, '');
  if (!w) return false;
  if (NAMES.has(w) || NAMES.has(word.toLowerCase().replace(/ё/g, 'е'))) return true;
  return ROOTS.some(root => w.startsWith(root) && w.length <= root.length + 5 && w.length > root.length && DIMINUTIVE.test(w.slice(root.length - 1)));
};

const isInitial = (word: string) => /^[\p{Lu}]\.?$/u.test(word) || /^[\p{Lu}]\.[\p{Lu}]\.?$/u.test(word);
const isGeneric = (word: string) => GENERIC.has(word.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}-]/gu, ''));
const isAllCaps = (word: string) => /^[\p{Lu}\d@&$'-]{2,}$/u.test(word) && /\p{Lu}/u.test(word);
const isAdjective = (word: string) => /^\p{Lu}?\p{Ll}+(?:ый|ий|ой|ая|яя)$/u.test(word);

// Формула вежливости перед ником («С уважением, О'К», «С любовью, Kurtочк@»): ник — то, что после неё.
const CLOSING = /^\s*с\s+(?:уважением|любовью|приветом)\s*[,:]?\s*(?=\S)/iu;

// Ядро подписи: без формулы вежливости, пояснений в скобках и хвоста после запятой
// («Аня-пулемётчица, СШ 4», «Lee-der, г. Амурск»), без точки в конце.
export function nickCore(from: string): string {
  return from
    .replace(CLOSING, '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/,(?![^«]*»)/)[0]
    .replace(/[«»"“”]/g, '')
    .replace(/[.!\s]+$/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function classifyNick(from: string): NickClass {
  const core = nickCore(from);
  const key = normalizeName(core);
  if (!key) return 'generic';
  if (EDITORIAL.has(key)) return 'editorial';
  const words = core.split(' ').filter(Boolean);
  // Несколько подписавшихся: «Лена, Марина и Лена», «Kurt & Kurtочк@».
  const whole = from.replace(/\([^)]*\)/g, ' ').trim();
  if (/^\S+(?:,\s*\S+)*\s+(?:и|&|and)\s+\S+$/iu.test(whole)) return 'group';
  if (from.split(',').length > 2 && from.split(',').slice(0, 2).every(part => isFirstName(nickCore(part)))) return 'group';
  // «Твоя …», «Девушка с характером», «Подруга Саша»: описание, а не ник.
  if (isGeneric(words[0])) return 'generic';
  if (words.length > 3) return 'generic';
  const names = words.filter(isFirstName);
  const rest = words.filter(word => !isFirstName(word) && !isInitial(word) && !isGeneric(word) && !/^\d+$/.test(word));
  if (!rest.length) return names.length ? 'firstName' : 'generic';
  // «Настя Никонова», «Дорофеев Артём»: имя и фамилия — реальный человек.
  if (names.length && rest.length === 1 && /^\p{Lu}[\p{Ll}\p{Lu}-]+$/u.test(rest[0]) && /\p{Script=Cyrillic}/u.test(rest[0]) && SURNAME.test(rest[0].toLowerCase())) return 'realName';
  if (rest.every(word => isAdjective(word)) && names.length) return 'firstName';
  return 'unique';
}

export type NickMessage = { id: string; date: string; from: string | null };
export type Nick = { key: string; name: string; spellings: string[]; class: NickClass; unique: boolean; messages: number; first: string; last: string; ids: string[] };
// Ручные решения (scripts/pager-nick-aliases.json): aliases — подпись → ник (склеить),
// distinct — группы разных людей, которых не предлагать в кандидаты («Kurt» и «Kurtочк@»).
// joint — совместная подпись → её авторы («ICEPAC&Liga-X» → ICEPAC и Liga-X): сообщение идёт в каждый профиль.
// shared — подписи, под которыми пишут разные люди: сообщения остаются в ленте, профиля нет.
export type NickRules = { aliases?: Record<string, string>; distinct?: string[][]; joint?: Record<string, string[]>; shared?: string[] };

const aliasOf = (core: string, rules: NickRules) =>
  Object.entries(rules.aliases ?? {}).find(([spelling]) => normalizeName(spelling) === normalizeName(core))?.[1] ?? null;
const jointOf = (core: string, rules: NickRules) =>
  Object.entries(rules.joint ?? {}).find(([signature]) => normalizeName(signature) === normalizeName(core))?.[1] ?? null;

// Один ник — одна нормализованная подпись (регистр, «ё», похожие латинские буквы не важны).
// Разные подписи склеиваются только ручным правилом: похожее начало ничего не значит.
export function nickKey(from: string, rules: NickRules = {}): string {
  const core = nickCore(from);
  return normalizeName(aliasOf(core, rules) ?? core);
}

// Авторы подписи: совместная («ICEPAC&Liga-X») — каждый из них, иначе сама подпись.
export function signatureAuthors(from: string, rules: NickRules = {}): { authors: string[]; joint: boolean } {
  const authors = jointOf(nickCore(from), rules);
  return authors ? { authors, joint: true } : { authors: [from], joint: false };
}

export function buildNicks(messages: NickMessage[], rules: NickRules = {}): Nick[] {
  const groups = new Map<string, { spellings: Map<string, number>; ids: string[]; dates: string[]; target: string | null }>();
  for (const message of messages) {
    if (!message.from?.trim()) continue;
    const core = nickCore(message.from);
    const { authors, joint } = signatureAuthors(message.from, rules);
    for (const author of authors) {
      const key = nickKey(author, rules);
      if (!key) continue;
      let group = groups.get(key);
      if (!group) groups.set(key, (group = { spellings: new Map(), ids: [], dates: [], target: null }));
      group.spellings.set(core, (group.spellings.get(core) ?? 0) + 1);
      // A joint signature names the author's profile by the author, never by the joint spelling.
      group.target ??= joint ? (aliasOf(nickCore(author), rules) ?? author) : aliasOf(core, rules);
      group.ids.push(message.id);
      group.dates.push(message.date);
    }
  }
  const shared = new Set((rules.shared ?? []).map(name => normalizeName(name)));
  return [...groups.entries()].map(([key, group]) => {
    const spellings = [...group.spellings.entries()].sort((a, b) => b[1] - a[1]).map(([spelling]) => spelling);
    const name = group.target ?? spellings[0];
    const nickClass: NickClass = shared.has(key) ? 'shared' : classifyNick(name);
    const dates = [...group.dates].sort();
    return { key, name, spellings, class: nickClass, unique: nickClass === 'unique', messages: group.ids.length, first: dates[0], last: dates[dates.length - 1], ids: group.ids };
  }).sort((a, b) => b.messages - a.messages || (a.key < b.key ? -1 : 1));
}

// «Прилагательное + ник капслоком»: «Умиротворенный BAD» → «BAD». Только подсказка кандидата.
export function adjectiveTarget(core: string): string | null {
  const words = core.split(' ');
  if (words.length < 2) return null;
  const last = words[words.length - 1];
  return isAllCaps(last) && words.slice(0, -1).every(isAdjective) ? last : null;
}

export type ProfileCandidate = { names: string[]; keys: string[]; messages: number; reasons: string[] };

// Кандидаты в один профиль — для ручного подтверждения, ничего не склеивается:
// одинаковые без пробелов и знаков («Ice Pac» / «Icepac»), один уникальный ник — начало другого
// («ICE» / «ICEPAC»), прилагательное перед ником («Умиротворенный BAD» / «BAD»).
export function profileCandidates(nicks: Nick[], rules: NickRules = {}): ProfileCandidate[] {
  const compact = (key: string) => key.replace(/[^\p{L}\p{N}]/gu, '');
  const distinct = (rules.distinct ?? []).map(group => new Set(group.map(name => normalizeName(name))));
  const pairs: [number, number, string][] = [];
  const allowed = (a: Nick, b: Nick) => !distinct.some(group => group.has(a.key) && group.has(b.key));
  const byKey = new Map(nicks.map((nick, i) => [nick.key, i]));
  nicks.forEach((a, i) => {
    const target = adjectiveTarget(a.name);
    const j = target ? byKey.get(normalizeName(target)) : undefined;
    if (j !== undefined && j !== i && allowed(a, nicks[j])) pairs.push([i, j, 'прилагательное перед ником']);
    nicks.forEach((b, k) => {
      if (k <= i || !allowed(a, b)) return;
      const ca = compact(a.key);
      const cb = compact(b.key);
      if (ca && ca === cb) pairs.push([i, k, 'то же без пробелов и знаков']);
      else if (a.unique && b.unique && Math.min(ca.length, cb.length) >= 3 && (ca.startsWith(cb) || cb.startsWith(ca))) pairs.push([i, k, 'одно начинается с другого']);
    });
  });
  const parent = nicks.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const reasons = new Map<number, Set<string>>();
  for (const [a, b] of pairs) parent[find(a)] = find(b);
  for (const [a, , reason] of pairs) {
    const root = find(a);
    if (!reasons.has(root)) reasons.set(root, new Set());
    reasons.get(root)!.add(reason);
  }
  const clusters = new Map<number, number[]>();
  nicks.forEach((_, i) => {
    if (!reasons.has(find(i))) return;
    if (!clusters.has(find(i))) clusters.set(find(i), []);
    clusters.get(find(i))!.push(i);
  });
  return [...clusters.entries()]
    .map(([root, members]) => ({
      names: members.map(i => nicks[i].name),
      keys: members.map(i => nicks[i].key),
      messages: members.reduce((sum, i) => sum + nicks[i].messages, 0),
      reasons: [...reasons.get(root)!],
    }))
    .sort((a, b) => b.messages - a.messages);
}

