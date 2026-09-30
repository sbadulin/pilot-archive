// Page recognition through Cloudflare: Gemini first, Claude Sonnet when Gemini refuses or fails.
// Auth: CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID), or the local `wrangler login` token.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

export const PRIMARY = 'google/gemini-3.8-flash';
export const FALLBACK = 'anthropic/claude-sonnet-5.5';
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || 'f8ae082199efcca3522f5735982edee9';
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai`;

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

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const cfg = readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, 'utf8');
  const m = cfg.match(/^oauth_token\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error('No Cloudflare token: set CLOUDFLARE_API_TOKEN or run `wrangler login`');
  return m[1];
}

class RecognitionError extends Error {
  constructor(message, refused = false) { super(message); this.refused = refused; }
}

async function post(path, body, attempt = 0) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  // The `wrangler login` token lives about an hour; any wrangler command refreshes it.
  if (res.status === 401 && !process.env.CLOUDFLARE_API_TOKEN && attempt === 0) {
    execFileSync('npx', ['--no-install', 'wrangler', 'whoami'], { stdio: 'ignore' });
    return post(path, body, attempt + 1);
  }
  // The gateway rate-limits third-party models; back off and retry.
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
    return post(path, body, attempt + 1);
  }
  if (!res.ok || json.success === false || json.type === 'error') {
    const text = JSON.stringify(json.errors ?? json.error ?? json).slice(0, 300);
    throw new RecognitionError(`${body.model}: ${res.status} ${text}`, /moderation/i.test(text));
  }
  return json.result ?? json;
}

const parseJson = (text) => JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));

async function askGemini(model, jpeg) {
  const result = await post('/run', {
    model,
    input: {
      contents: [{ role: 'user', parts: [{ inline_data: { mime_type: 'image/jpeg', data: jpeg.toString('base64') } }, { text: PROMPT }] }],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    },
  });
  return { text: result.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '', usage: result.usageMetadata };
}

async function askClaude(model, jpeg) {
  const result = await post('/v1/messages', {
    model,
    max_tokens: 8000,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: jpeg.toString('base64') } },
      { type: 'text', text: PROMPT },
    ] }],
  });
  return { text: result.content?.filter((b) => b.type === 'text').map((b) => b.text).join('') ?? '', usage: result.usage };
}

async function recognizeWith(model, jpeg) {
  const { text, usage } = await (model.startsWith('google/') ? askGemini(model, jpeg) : askClaude(model, jpeg));
  try {
    return { model, usage, result: parseJson(text) };
  } catch {
    throw new RecognitionError(`${model}: unparsable answer: ${text.slice(0, 200)}`);
  }
}

// Returns { model, status: 'ok', result, fallbackReason? } or throws when both models fail.
export async function recognizeSheet(jpeg) {
  try {
    return { status: 'ok', ...(await recognizeWith(PRIMARY, jpeg)) };
  } catch (e) {
    const fallback = await recognizeWith(FALLBACK, jpeg);
    return { status: 'ok', ...fallback, fallbackReason: e.refused ? 'refused' : e.message };
  }
}
