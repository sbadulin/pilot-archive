import { requireCurator, json } from '../../../_lib/auth';
import { selectelUrl, storageMode } from '../../../_lib/selectel';

export async function onRequestPost(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  let input: any = {};
  try { input = await context.request.json(); } catch {}
  const reason = String(input.reason ?? '').trim();
  if (!reason) return json({ error: 'Укажите причину отклонения.' }, { status: 400 });
  const row = await context.env.DB.prepare(`SELECT id, storage_key AS storageKey, status FROM issue_submissions WHERE id = ? AND status = 'pending'`).bind(context.params.id).first();
  if (!row) return json({ error: 'Заявка не найдена или уже обработана.' }, { status: 409 });
  if (storageMode(context.env) === 'selectel') {
    const source = await selectelUrl(context.env, `pending/${row.storageKey}`, 'GET');
    const target = await selectelUrl(context.env, `rejected/${row.storageKey}`, 'PUT');
    if (source && target) {
      const object = await fetch(source);
      if (object.ok && object.body) await fetch(target, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: object.body });
      const coverSource = await selectelUrl(context.env, `pending/${row.storageKey}.cover.jpg`, 'GET');
      const coverTarget = await selectelUrl(context.env, `rejected/${row.storageKey}.cover.jpg`, 'PUT');
      if (coverSource && coverTarget) {
        const cover = await fetch(coverSource);
        if (cover.ok && cover.body) await fetch(coverTarget, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: cover.body });
      }
      const remove = await selectelUrl(context.env, `pending/${row.storageKey}`, 'DELETE');
      if (remove) await fetch(remove, { method: 'DELETE' });
      const removeCover = await selectelUrl(context.env, `pending/${row.storageKey}.cover.jpg`, 'DELETE');
      if (removeCover) await fetch(removeCover, { method: 'DELETE' });
    }
  } else if (context.env.ISSUES_BUCKET) {
    const rejectedKey = `rejected/${row.storageKey}`;
    const object = await context.env.ISSUES_BUCKET.get(row.storageKey);
    if (object) {
      await context.env.ISSUES_BUCKET.put(rejectedKey, object.body, { httpMetadata: object.httpMetadata, customMetadata: object.customMetadata });
      await context.env.ISSUES_BUCKET.delete(row.storageKey);
    }
  }
  const now = new Date().toISOString();
  await context.env.DB.prepare(`UPDATE issue_submissions SET status = 'rejected', rejection_reason = ?, storage_key = ?, updated_at = ? WHERE id = ?`).bind(reason, row.storageKey, now, row.id).run();
  return json({ id: row.id, status: 'rejected', rejectionReason: reason, cleanup: '7 days' });
}
