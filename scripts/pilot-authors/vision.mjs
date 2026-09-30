// Pilot: ask a Workers AI vision model for the articles and bylines on one scanned page.
// Usage: node vision.mjs <model> <out-dir> <page.jpg>...
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { run, messages } from './cf.mjs';

const PROMPT = `Это скан страницы российской молодёжной газеты «Первый Пилот» (Комсомольск-на-Амуре, 1996–2007).
Найди на странице все материалы (статьи, заметки, интервью, стихи, рубрики) и для каждого укажи подпись автора ровно так, как она напечатана.
Подпись обычно стоит в конце материала (часто жирным или курсивом, справа), иногда под заголовком. Это может быть имя, фамилия, инициалы, псевдоним («ЛЯНА», «Князь Тишины») или коллектив («Девчата ПУ-33»).
Колонки коротких писем и объявлений читателей («Переписка», «Строки из конверта», «Вот такое письмо», знакомства) НЕ объединяй в один материал: перечисли КАЖДОЕ подписанное письмо или объявление отдельно (title — рубрика и первые слова, byline — его подпись).
Если подписи нет — byline: null. Подписи к фото и рисункам («Фото ...», «Рисунок ...») выноси отдельно в credits.
Для каждой подписи дополнительно выдели authors — чистые имена авторов без служебных слов («Прислала», «Беседовала», «Материал подготовил», «записали»), без возраста, школы, класса и города. Несколько авторов — отдельными элементами. Примеры:
«Прислала Катя Иващенко, 12 лет.» → ["Катя Иващенко"]; «Откровение VIRUS'а записали Sly и Neo» → ["Sly", "Neo"]; «Беседовала Бланкита, г. Амурск» → ["Бланкита"]; «Ваша КАТЕРИНА» → ["КАТЕРИНА"]; «Девчата ПУ-33 г. Амурска» → ["Девчата ПУ-33"].
Люди, о которых написан материал, и цитируемые авторы (исполнители песен, классики) — не авторы материала.
Если это обложка (первая полоса), дополнительно заполни cover: номер выпуска, сквозной номер в скобках, дату выхода.
Ответь ТОЛЬКО JSON без пояснений по схеме:
{"cover": {"number": "11", "serial": "0076", "date": "2000-03-15"} | null,
 "articles": [{"title": "...", "byline": "..." | null, "authors": ["..."]}],
 "credits": [{"kind": "photo" | "drawing", "name": "..."}]}`;

// Pager/greetings pages: dozens of short signed messages in tiny type, read tile by tile.
const PAGER_PROMPT = `Это фрагмент страницы «Пейджер» российской газеты «Первый Пилот» (2000 г.): короткие сообщения-приветы, каждое начинается с квадратика ■ и заканчивается подписью отправителя (жирным, справа): имя, псевдоним, «Ваша Юля», «Пацаны 6В класса» и т.п.
Перечисли ВСЕ сообщения на фрагменте, которые видны целиком вместе с подписью. Подпись копируй ровно как напечатана. Обрезанные краем фрагмента сообщения пропускай.
Ответь ТОЛЬКО JSON: {"articles": [{"title": "первые 4-6 слов сообщения", "byline": "подпись"}]}`;

const parseJson =(text) => {
  const s = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  try { return JSON.parse(s); } catch { return { parseError: true, raw: text }; }
};

const [model, outDir, ...pages] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
for (const page of pages) {
  const url = `data:image/jpeg;base64,${readFileSync(page).toString('base64')}`;
  const started = Date.now();
  const prompt = process.env.PROMPT === 'pager' ? PAGER_PROMPT : PROMPT;
  try {
    const result = model.startsWith('google/')
      ? await run(model, {
        contents: [{ role: 'user', parts: [
          { inline_data: { mime_type: 'image/jpeg', data: readFileSync(page).toString('base64') } },
          { text: prompt },
        ] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      })
      : model.startsWith('anthropic/')
      ? await messages({
        model,
        max_tokens: 8000,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: readFileSync(page).toString('base64') } },
          { type: 'text', text: prompt },
        ] }],
      })
      : await run(model, {
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url, detail: 'high' } }] }],
        max_tokens: 4000,
        temperature: 0,
      });
    const text = result.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? result.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') ?? result.response ?? result.choices?.[0]?.message?.content ?? JSON.stringify(result);
    const out = { page: basename(page), model, ms: Date.now() - started, usage: result.usage ?? result.usageMetadata, ...parseJson(typeof text === 'string' ? text : JSON.stringify(text)) };
    writeFileSync(`${outDir}/${basename(page, '.jpg')}.json`, JSON.stringify(out, null, 2));
    console.log(basename(page), `${out.ms}ms`, out.parseError ? 'PARSE ERROR' : `${out.articles?.length ?? 0} articles`);
  } catch (e) {
    console.log(basename(page), 'ERROR', e.message);
  }
}
