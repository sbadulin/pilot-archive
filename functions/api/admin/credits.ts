import { requireCurator, json } from '../_lib/auth';
import { normalizeName } from '../../../src/authorNames';

const KINDS = new Set(['article', 'letter', 'photo', 'drawing', 'other']);

// A byline the recognition missed, added by hand. Re-recognition never touches it.
export async function onRequestPost(context: any) {
  const user = requireCurator(context);
  if (user instanceof Response) return user;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  let input: any;
  try { input = await context.request.json(); } catch { return json({ error: 'Ожидался JSON с подписью.' }, { status: 400 }); }
  const year = Number(input?.year);
  const number = String(input?.number ?? '').padStart(2, '0');
  const serial = String(input?.serial ?? '');
  const page = Number(input?.page);
  const name = String(input?.name ?? '').replace(/\s+/g, ' ').trim();
  const title = String(input?.title ?? '').replace(/\s+/g, ' ').trim() || null;
  const kind = String(input?.kind ?? 'article');
  if (!(year >= 1996 && year <= 2007) || !/^\d{2,3}$/.test(number) || !/^\d{0,5}$/.test(serial)) return json({ error: 'Выберите номер газеты.' }, { status: 400 });
  if (!Number.isInteger(page) || page < 1 || page > 100) return json({ error: 'Укажите страницу номера.' }, { status: 400 });
  if (!normalizeName(name) || name.length > 200) return json({ error: 'Укажите имя автора.' }, { status: 400 });
  if (!KINDS.has(kind) || (title && title.length > 300)) return json({ error: 'Проверьте тип и заголовок материала.' }, { status: 400 });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  // The sheet is unknown for hand-added credits; the printed page is what links use.
  await context.env.DB.prepare(
    `INSERT INTO credits (id, issue_year, issue_number, issue_serial, sheet, printed_page, kind, title, byline, name, name_key, source, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)`,
  ).bind(id, year, number, serial, page, page, kind, title, name, name, normalizeName(name), `curator:${user.email}`, now, now).run();
  return json({ id }, { status: 201 });
}
