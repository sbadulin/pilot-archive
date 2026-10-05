// Byline recognition of one scanned sheet. Shared by the approval flow (Workers AI binding)
// and scripts/authors (REST), so both read pages the same way.

export const PRIMARY = 'google/gemini-3.8-flash';
export const FALLBACK = 'anthropic/claude-sonnet-5.5';

export const PROMPT = `Это скан страницы российской молодёжной газеты «Первый Пилот» (Комсомольск-на-Амуре, 1996–2007).
Сначала определи тип страницы pageType: "regular" — обычная полоса со статьями; "pager" — «Пейджер» или подобная полоса из десятков коротких приветов с подписями; "tv" — телепрограмма.
Для "pager" и "tv" верни пустой articles.
Для "regular" найди все материалы (статьи, заметки, интервью, стихи, рубрики) и для каждого укажи подпись автора ровно так, как она напечатана.
Подпись обычно стоит в конце материала (часто жирным или курсивом, справа), иногда под заголовком. Это может быть имя, фамилия, инициалы, псевдоним («ЛЯНА», «Князь Тишины») или коллектив («Девчата ПУ-33»).
Колонки коротких писем и объявлений читателей («Переписка», «Строки из конверта», «Вот такое письмо», знакомства) НЕ объединяй в один материал: перечисли КАЖДОЕ подписанное письмо или объявление отдельно с kind "letter" (title — рубрика и первые слова, byline — его подпись). Остальные материалы — kind "article".
Если подписи нет — byline: null. Подписи к фото и рисункам («Фото ...», «Рисунок ...») выноси отдельно в credits.
Для каждой подписи дополнительно выдели authors — чистые имена авторов без служебных слов («Прислала», «Беседовала», «Материал подготовил», «записали»), без возраста, школы, класса и города. Несколько авторов — отдельными элементами. Примеры:
«Прислала Катя Иващенко, 12 лет.» → ["Катя Иващенко"]; «Откровение VIRUS'а записали Sly и Neo» → ["Sly", "Neo"]; «Беседовала Бланкита, г. Амурск» → ["Бланкита"]; «Ваша КАТЕРИНА» → ["КАТЕРИНА"]; «Девчата ПУ-33 г. Амурска» → ["Девчата ПУ-33"].
Люди, о которых написан материал, и цитируемые авторы (исполнители песен, классики) — не авторы материала.
Если это обложка (первая полоса), дополнительно заполни cover: номер выпуска, сквозной номер в скобках, дату выхода.
Ответь ТОЛЬКО JSON без пояснений по схеме:
{"pageType": "regular" | "pager" | "tv",
 "cover": {"number": "11", "serial": "0076", "date": "2000-03-15"} | null,
 "articles": [{"kind": "article" | "letter", "title": "...", "byline": "..." | null, "authors": ["..."]}],
 "credits": [{"kind": "photo" | "drawing", "name": "..."}]}`;

// env.AI in a Function, or a REST adapter with the same shape in scripts.
export type ModelRunner = { run(model: string, input: unknown): Promise<any> };

export type SheetRecognition = { model: string; result: any; usage?: unknown; fallbackReason?: string };

const parseJson = (text: string) => JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

async function ask(ai: ModelRunner, model: string, jpegBase64: string): Promise<SheetRecognition> {
  let text: string;
  let usage: unknown;
  if (model.startsWith('google/')) {
    const r = await ai.run(model, {
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/jpeg', data: jpegBase64 } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    });
    text = r?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
    usage = r?.usageMetadata;
  } else {
    const r = await ai.run(model, {
      max_tokens: 8000,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpegBase64 } },
        { type: 'text', text: PROMPT },
      ] }],
    });
    text = r?.content?.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('') ?? '';
    usage = r?.usage;
  }
  try {
    return { model, usage, result: parseJson(text) };
  } catch {
    throw new Error(`${model}: unparsable answer: ${text.slice(0, 200)}`);
  }
}

// Models fail now and then under load (rate limits, timeouts); one more try a moment later
// usually works. A refusal or an empty balance will not change, so those are not retried.
// One retry per model keeps the request under Cloudflare's 100-second response limit.
const RETRY_DELAY_MS = 3000;
async function askWithRetry(ai: ModelRunner, model: string, jpegBase64: string): Promise<SheetRecognition> {
  try {
    return await ask(ai, model, jpegBase64);
  } catch (e) {
    if (/moderation|insufficient balance|402/i.test((e as Error).message)) throw e;
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    return ask(ai, model, jpegBase64);
  }
}

// Gemini first; Claude when Gemini refuses (content moderation), fails or answers garbage.
export async function recognizeSheet(ai: ModelRunner, jpegBase64: string): Promise<SheetRecognition> {
  try {
    return await askWithRetry(ai, PRIMARY, jpegBase64);
  } catch (e) {
    const reason = (e as Error).message;
    let fallback: SheetRecognition;
    try {
      fallback = await askWithRetry(ai, FALLBACK, jpegBase64);
    } catch (fallbackError) {
      // Both answers are needed to tell a Gemini outage from a Claude one.
      throw new Error(`Gemini: ${reason.slice(0, 160)}; Claude: ${(fallbackError as Error).message.slice(0, 160)}`);
    }
    return { ...fallback, fallbackReason: /moderation/i.test(reason) ? 'refused' : reason.slice(0, 200) };
  }
}
