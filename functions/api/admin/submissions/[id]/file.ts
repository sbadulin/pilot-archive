import { requireCurator, requireSubmitter, json } from '../../../_lib/auth';
import { selectelUrl, storageMode } from '../../../_lib/selectel';

export async function onRequestGet(context: any) {
  const user = requireCurator(context);
  if (user instanceof Response) return user;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  const row = await context.env.DB.prepare(`SELECT storage_key AS storageKey, filename, status FROM issue_submissions WHERE id = ?`).bind(context.params.id).first();
  if (!row) return json({ error: 'Заявка не найдена.' }, { status: 404 });
  const mode = storageMode(context.env);
  const key = mode === 'selectel'
    ? `${row.status === 'rejected' ? 'rejected' : row.status === 'approved' ? 'published' : 'pending'}/${row.storageKey}`
    : row.storageKey;
  if (mode === 'selectel') {
    const url = await selectelUrl(context.env, key, 'GET');
    if (!url) return json({ error: 'Selectel S3 не настроен.' }, { status: 503 });
    const response = await fetch(url);
    if (!response.ok) return json({ error: 'PDF заявки не найден.' }, { status: response.status === 404 ? 404 : 502 });
    const filename = String(row.filename).replace(/"/g, '');
    return new Response(response.body, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${filename}"` } });
  }
  if (!context.env.ISSUES_BUCKET) return json({ error: 'R2 ещё не подключён.' }, { status: 503 });
  const object = await context.env.ISSUES_BUCKET.get(key);
  if (!object) return json({ error: 'PDF заявки не найден.' }, { status: 404 });
  const filename = String(row.filename).replace(/"/g, '');
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/pdf', 'content-disposition': `inline; filename="${filename}"` } });
}

export async function onRequestPut(context: any) {
  const user = requireSubmitter(context);
  if (user instanceof Response) return user;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  if (storageMode(context.env) === 'selectel') return json({ error: 'Для этой заявки используйте временную ссылку загрузки.' }, { status: 409 });
  if (!context.env.ISSUES_BUCKET) return json({ error: 'R2 ещё не подключён.' }, { status: 503 });
  const row = await context.env.DB.prepare(`SELECT id, storage_key AS storageKey, status, submitted_by AS submittedBy FROM issue_submissions WHERE id = ?`).bind(context.params.id).first();
  if (!row) return json({ error: 'Заявка не найдена.' }, { status: 404 });
  if (row.status !== 'pending' || (row.submittedBy !== user.email && user.role !== 'curator')) return json({ error: 'Эта заявка недоступна для загрузки.' }, { status: 403 });
  const type = context.request.headers.get('content-type') ?? '';
  if (type !== 'application/pdf') return json({ error: 'Загрузить можно только PDF.' }, { status: 415 });
  const length = Number(context.request.headers.get('content-length') ?? 0);
  if (length > 100 * 1024 * 1024) return json({ error: 'PDF больше 100 МБ.' }, { status: 413 });
  await context.env.ISSUES_BUCKET.put(row.storageKey, context.request.body, { httpMetadata: { contentType: 'application/pdf' }, customMetadata: { submittedBy: user.email } });
  const now = new Date().toISOString();
  await context.env.DB.prepare(`UPDATE issue_submissions SET updated_at = ? WHERE id = ?`).bind(now, row.id).run();
  return json({ id: row.id, status: 'pending' });
}
