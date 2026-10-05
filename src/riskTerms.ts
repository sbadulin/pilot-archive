// Словарь для поиска материалов, которые по нынешним российским законам могут потребовать
// изъятия или маркировки. Это фильтр для куратора, а не юридическая оценка: каждое
// совпадение смотрит человек, а спорные случаи — юрист.
//
// Термин — это основа слова: совпадение ищется с начала слова (`гомосексуал` найдёт
// «гомосексуалисты»). Термин с `=` в конце должен совпасть со словом целиком (`гей=`
// не найдёт «гейша»). Слабые термины чаще всего встречаются в безобидном смысле
// («голубое небо», «трава у дома») и показываются в отчёте отдельно.

export type RiskCategory =
  | "lgbt"
  | "drugs"
  | "suicide"
  | "sexual"
  | "childfree"
  | "extremism"
  | "profanity";

export const riskCategoryLabels: Record<RiskCategory, string> = {
  lgbt: "ЛГБТ",
  drugs: "Наркотики",
  suicide: "Суицид",
  sexual: "Сексуальный контент",
  childfree: "Чайлдфри и аборты",
  extremism: "Экстремизм, терроризм, нацизм",
  profanity: "Мат",
};

type TermList = { strong: string[]; weak?: string[] };

const terms: Record<RiskCategory, TermList> = {
  lgbt: {
    strong: [
      "гей=", "геи=", "геев=", "геям=", "геями=", "гейск", "гомосек", "гомик", "педик",
      "пидор", "пидар", "лесби", "бисексуал", "трансвестит", "транссексуал", "трансгендер",
      "однопол", "нетрадиционн", "сексуальных меньшинств", "сексменьшинств", "лгбт",
      "камин-аут", "каминг-аут", "голубизн",
    ],
    // Не основа «голуб»: она находит «голубоглазая» и «серо-голубые глаза» в каждом объявлении.
    weak: ["голубой=", "голубые=", "голубого=", "голубых=", "ориентаци", "розовые=", "травести"],
  },
  drugs: {
    strong: [
      "наркот", "наркоман", "нарколог", "анаш", "марихуан", "конопл", "гашиш", "экстази=",
      "героин", "кокаин", "лсд=", "амфетамин", "метадон", "мескалин", "галлюциноген", "опиум",
      "опиат", "ширя", "ширну", "торчк", "обдолбан", "укуренн", "обкур",
      "косячок", "травк", "дурь=", "спайс", "вмазать", "вмазал",
    ],
    weak: ["трава=", "траву=", "косяк", "кайф", "колеса=", "грибы=", "грибочк", "кумар"],
  },
  suicide: {
    strong: [
      "суицид", "самоубий", "покончить с собой", "покончил с собой", "покончила с собой",
      "наложить на себя руки", "вскрыть вены", "вскрыла вены", "вскрыл вены", "повеситься",
      "повесилась", "повесился", "жить не хочется", "не хочу жить", "хочу умереть",
      "выпрыгнуть из окна", "наглотаться таблеток", "свести счеты с жизнью",
    ],
    weak: ["умереть="],
  },
  sexual: {
    strong: [
      "секс", "эрот", "порн", "оргазм", "мастурб", "онани", "девственн", "презерватив",
      "проститу", "стриптиз", "минет", "садомазо", "садо-мазо", "извращен", "изнасил",
      "педофил", "оральн", "анальн", "кончил=", "кончила=", "трахну", "трахал", "трахат",
      "переспал", "переспать", "интим",
    ],
    weak: ["голая=", "голые=", "голый=", "обнажен", "любовни", "соблазн", "охмур", "пасси"],
  },
  childfree: {
    strong: ["чайлдфри", "чайлд-фри", "не хочу детей", "не хочу рожать", "аборт", "стерилизаци"],
    weak: ["без детей", "бездетн", "залетел", "залетела", "беременн"],
  },
  extremism: {
    strong: [
      "нацист", "нацизм", "фашист", "фашизм", "свастик", "гитлер", "третий рейх", "третьего рейха",
      "зиг хайль", "скинхед", "скинов=", "скины=", "нбп=", "национал-большевик", "рне=",
      "русское национальное единство", "ауе=", "колумбайн", "скулшут", "басаев", "хаттаб",
      "ичкери", "ваххаб", "шахид", "аль-каид", "талибан", "свидетели иеговы", "свидетелей иеговы",
      "сатанист", "сатанизм", "джихад",
    ],
    weak: ["сатан", "чечен", "боевик", "теракт", "взрывчат", "бомб", "анархи"],
  },
  profanity: {
    strong: [
      "хуй", "хуя", "хуе", "хуё", "хуи", "нахуй", "пизд", "ебат", "ебал", "ебан", "ебну", "ебёт",
      "ебет", "ёбан", "ёб=", "заеб", "заёб", "выеб", "наеб", "наёб", "уеб", "уёб", "проеб", "разъеб",
      "отъеб", "съеб", "долбоеб", "долбоёб", "бля=", "блять", "бляд",
    ],
    weak: ["сука", "сучк", "мудак", "мудил", "говн", "жоп", "срать", "дерьм"],
  },
};

export type RiskMatch = {
  category: RiskCategory;
  term: string;
  weak: boolean;
  // Фрагмент исходного текста вокруг совпадения, для отчёта.
  excerpt: string;
};

export function normalizeForRisk(text: string): string {
  return text.toLowerCase().replace(/ё/g, "е");
}

type CompiledTerm = { category: RiskCategory; term: string; weak: boolean; pattern: RegExp };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compileTerm(category: RiskCategory, raw: string, weak: boolean): CompiledTerm {
  const whole = raw.endsWith("=");
  const term = whole ? raw.slice(0, -1) : raw;
  // Пробел в многословном термине совпадает с любым количеством пробелов и переносов строк.
  const body = escapeRegExp(normalizeForRisk(term)).replace(/ /g, "\\s+");
  // Дефис — часть слова: «Э-ге-гей» не должно совпасть с «гей».
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}-])${body}${whole ? "(?![\\p{L}\\p{N}-])" : ""}`, "gu");
  return { category, term, weak, pattern };
}

const compiled: CompiledTerm[] = (Object.entries(terms) as [RiskCategory, TermList][]).flatMap(
  ([category, list]) => [
    ...list.strong.map(term => compileTerm(category, term, false)),
    ...(list.weak ?? []).map(term => compileTerm(category, term, true)),
  ],
);

function excerptAround(text: string, start: number, length: number, radius = 60): string {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, start + length + radius);
  const snippet = text.slice(from, to).replace(/\s+/g, " ").trim();
  return `${from > 0 ? "…" : ""}${snippet}${to < text.length ? "…" : ""}`;
}

// Возвращает по одному совпадению на термин. Термины одной категории, совпавшие в одном
// месте («наркот» и «наркоман»), считаются одним совпадением, а слабые термины
// не показываются, если в тексте уже нашёлся сильный термин той же категории.
export function findRisks(text: string): RiskMatch[] {
  // normalizeForRisk не меняет длину строки, поэтому индексы совпадают с исходным текстом.
  const normalized = normalizeForRisk(text);
  const matches: (RiskMatch & { index: number })[] = [];
  for (const { category, term, weak, pattern } of compiled) {
    pattern.lastIndex = 0;
    const found = pattern.exec(normalized);
    if (!found) continue;
    const sameCategory = matches.filter(match => match.category === category);
    if (sameCategory.some(match => match.index === found.index)) continue;
    if (weak && sameCategory.some(match => !match.weak)) continue;
    matches.push({ category, term, weak, index: found.index, excerpt: excerptAround(text, found.index, found[0].length) });
  }
  return matches.map(({ index: _index, ...match }) => match);
}

// Сексуальный контент законен с маркировкой 18+, но не рядом с несовершеннолетними: в
// молодёжной газете письма и объявления часто подписаны возрастом («Скарлетт (15)»).
const minorPatterns = [
  /\(\s*(?:[5-9]|1[0-7])\s*(?:\)|\/|,|лет|год)/u,
  /(?<![\d.,])(?:[5-9]|1[0-7])\s*(?:-?ти\s+)?(?:лет|года|годам|годиков)(?!\p{L})/u,
  /(?<![\d.,])(?:[1-9]|1[01])\s*-?(?:й|м|го|ом)?\s+класс/u,
  /(?<![\p{L}-])(?:школьни|ученица|ученицы|несовершеннолет|малолет|подрост|тинейджер)/u,
  /классни(?:к|ц)/u,
];

export function mentionsMinor(text: string): boolean {
  const normalized = normalizeForRisk(text);
  return minorPatterns.some(pattern => pattern.test(normalized));
}

export type RiskAction = "redact" | "redactMinor" | "lawyer" | "adult" | "review";

// Порядок — от самого срочного к самому мягкому; в этом порядке идёт сводка отчёта.
export const riskActionLabels: Record<RiskAction, string> = {
  redact: "Закрыть",
  redactMinor: "Закрыть: несовершеннолетние",
  lawyer: "Показать юристу",
  adult: "Оставить с 18+",
  review: "Посмотреть",
};

// Запреты на эти темы действуют для любой аудитории, маркировка 18+ их не снимает.
const alwaysRedacted = new Set<RiskCategory>(["lgbt", "drugs", "suicide", "childfree", "extremism"]);

export function recommendAction(matches: RiskMatch[], minor: boolean): RiskAction {
  const strong = matches.filter(match => !match.weak);
  if (strong.some(match => alwaysRedacted.has(match.category))) return "redact";
  const sexualStrong = strong.some(match => match.category === "sexual");
  if (sexualStrong && minor) return "redactMinor";
  if (strong.some(match => match.category === "profanity")) return "lawyer";
  if (minor && matches.some(match => match.category === "sexual")) return "lawyer";
  if (sexualStrong) return "adult";
  return "review";
}
