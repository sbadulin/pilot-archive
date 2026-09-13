import { requireCurator, requireSubmitter, json } from '../_lib/auth';
import { issueKey, validateIssueInput } from '../_lib/validation';
import { selectelUrl, storageMode } from '../_lib/selectel';

export async function onRequestGet(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  const { results } = await context.env.DB.prepare(`SELECT id, year, number, serial, date, date_label AS dateLabel, filename, pages, status, submitted_by AS submittedBy, rejection_reason AS rejectionReason, created_at AS createdAt, updated_at AS updatedAt, published_at AS publishedAt FROM issue_submissions ORDER BY created_at DESC`).all();
  return json({ submissions: results });
}

export async function onRequestPost(context: any) {
  const user = requireSubmitter(context);
  if (user instanceof Response) return user;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  if (storageMode(context.env) === 'r2' && !context.env.ISSUES_BUCKET) return json({ error: 'Хранилище ещё не подключено.' }, { status: 503 });
  let input: any;
  try { input = await context.request.json(); } catch { return json({ error: 'Ожидался JSON с данными выпуска.' }, { status: 400 }); }
  const error = validateIssueInput(input);
  if (error) return json({ error }, { status: 400 });
  const duplicate = await context.env.DB.prepare(`SELECT id, status FROM issue_submissions WHERE year = ? AND number = ? AND serial = ?`).bind(Number(input.year), String(input.number).padStart(2, '0'), String(input.serial ?? '').padStart(4, '0')).first();
  if (duplicate) return json({ error: 'Такой выпуск уже есть в очереди или архиве.', duplicate }, { status: 409 });
  const id = crypto.randomUUID();
  const storageKey = issueKey(Number(input.year), String(input.number), String(input.serial ?? ''), id);
  const now = new Date().toISOString();
  await context.env.DB.prepare(`INSERT INTO issue_submissions (id, year, number, serial, date, date_label, filename, pages, storage_key, status, submitted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`).bind(id, Number(input.year), String(input.number).padStart(2, '0'), String(input.serial ?? '').padStart(4, '0'), input.date, input.dateLabel, input.filename, Number(input.pages), storageKey, user.email, now, now).run();
  const mode = storageMode(context.env);
  const uploadUrl = mode === 'selectel' ? await selectelUrl(context.env, `pending/${storageKey}`, 'PUT') : null;
  const coverUploadUrl = mode === 'selectel' ? await selectelUrl(context.env, `pending/${storageKey}.cover.jpg`, 'PUT') : null;
  return json({ id, storageKey, status: 'pending', storageMode: mode, uploadUrl, coverUploadUrl }, { status: 201 });
}
