import { requireCurator, json } from '../../../_lib/auth';
import { recognizeSheet, restRunner } from '../../../_lib/recognition';
import { creditId, creditsFromSheet } from '../../../../../src/authorNames';

// Sheets already recognized, so a retry sends only the missing ones.
export async function onRequestGet(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  const { DB } = context.env;
  if (!DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  const row = await DB.prepare(`SELECT year, number, serial FROM issue_submissions WHERE id = ?`).bind(context.params.id).first();
  if (!row) return json({ error: 'Заявка не найдена.' }, { status: 404 });
  const { results } = await DB.prepare(`SELECT sheet FROM recognition_runs WHERE issue_year = ? AND issue_number = ? AND issue_serial = ? AND status = 'ok'`)
    .bind(row.year, row.number, row.serial).all();
  return json({ sheets: results.map((r: any) => r.sheet) });
}

// Recognize bylines on one sheet of a submission. The curator's browser renders the pages
// and sends them one by one as base64 JPEG text: ?sheet=<PDF page>&page=<printed page>.
export async function onRequestPost(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  const { DB, AI, CLOUDFLARE_AI_TOKEN, CLOUDFLARE_ACCOUNT_ID } = context.env;
  // The REST API when its secrets are set (reliable); the Workers AI binding otherwise.
  const ai = CLOUDFLARE_AI_TOKEN && CLOUDFLARE_ACCOUNT_ID ? restRunner(CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_AI_TOKEN) : AI;
  if (!DB || !ai) return json({ error: 'D1 или Workers AI не подключены.' }, { status: 503 });
  const url = new URL(context.request.url);
  const sheet = Number(url.searchParams.get('sheet'));
  const printedPage = Number(url.searchParams.get('page'));
  if (!Number.isInteger(sheet) || sheet < 1 || sheet > 100 || !Number.isInteger(printedPage) || printedPage < 1)
    return json({ error: 'Укажите лист и страницу.' }, { status: 400 });
  const row = await DB.prepare(`SELECT year, number, serial FROM issue_submissions WHERE id = ?`).bind(context.params.id).first();
  if (!row) return json({ error: 'Заявка не найдена.' }, { status: 404 });
  // Kept as text: parsing a large JSON body would spend the Function's CPU budget.
  const image = (await context.request.text()).replace(/^data:image\/jpeg;base64,/, '');
  if (!image || image.length > 12_000_000) return json({ error: 'Нужна страница в JPEG.' }, { status: 400 });

  let recognized;
  try {
    recognized = await recognizeSheet(ai, image);
  } catch (e) {
    const message = (e as Error).message;
    // Visible in `wrangler pages deployment tail`.
    console.error(`recognize ${context.params.id} sheet ${sheet}: ${message}`);
    // An empty AI Gateway balance fails every sheet; the browser stops and says so.
    if (/insufficient balance|402/i.test(message))
      return json({ error: 'Баланс AI Gateway закончился — пополните его и нажмите «Распознать подписи».', code: 'balance' }, { status: 402 });
    return json({ error: `Не удалось распознать лист ${sheet}: ${message.slice(0, 200)}` }, { status: 502 });
  }
  const credits = creditsFromSheet(recognized.result, { year: row.year, number: row.number, serial: row.serial, sheet, printedPage, source: recognized.model });
  const now = new Date().toISOString();
  const statements = [
    DB.prepare(`INSERT OR REPLACE INTO recognition_runs (issue_year, issue_number, issue_serial, sheet, model, status, raw_json, created_at) VALUES (?, ?, ?, ?, ?, 'ok', ?, ?)`)
      .bind(row.year, row.number, row.serial, sheet, recognized.model, JSON.stringify(recognized.result), now),
  ];
  for (const c of credits)
    statements.push(DB.prepare(`INSERT INTO credits (id, issue_year, issue_number, issue_serial, sheet, printed_page, kind, title, byline, name, name_key, source, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', ?, ?) ON CONFLICT(id) DO NOTHING`)
      .bind(await creditId(c), c.year, c.number, c.serial, c.sheet, c.printedPage, c.kind, c.title, c.byline, c.name, c.nameKey, c.source, now, now));
  // Curator corrections apply to fresh recognitions too.
  statements.push(DB.prepare(`UPDATE credits SET name = f."right", name_key = f.right_key, updated_at = ? FROM name_fixes f
    WHERE credits.name = f.wrong AND credits.issue_year = ? AND credits.issue_number = ? AND credits.issue_serial = ?`).bind(now, row.year, row.number, row.serial));
  await DB.batch(statements);
  return json({ sheet, pageType: recognized.result?.pageType ?? null, model: recognized.model, fallback: recognized.fallbackReason ?? null, credits: credits.length });
}
