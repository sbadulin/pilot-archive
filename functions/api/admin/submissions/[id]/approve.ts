import { requireCurator, json } from '../../../_lib/auth';
import { selectelPublicBucket, selectelUrl, storageMode } from '../../../_lib/selectel';
import { baseCatalog } from '../../../_lib/baseCatalog';
import { composeManifest } from '../../../_lib/manifest';
import { archiveCoverKey, archiveKey } from '../../../_lib/validation';

export async function onRequestPost(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  const row = await context.env.DB.prepare(`SELECT id, year, number, serial, storage_key AS storageKey, status FROM issue_submissions WHERE id = ?`).bind(context.params.id).first();
  if (!row) return json({ error: 'Заявка не найдена.' }, { status: 404 });
  if (row.status !== 'pending') return json({ error: 'Заявка уже обработана.' }, { status: 409 });
  if (storageMode(context.env) === 'selectel') {
    const publishedKey = archiveKey(row.year, row.number, row.serial, row.id);
    const publishedCoverKey = archiveCoverKey(row.year, row.number, row.serial, row.id);
    const source = await selectelUrl(context.env, `pending/${row.storageKey}`, 'GET');
    const target = await selectelUrl(context.env, publishedKey, 'PUT', 900, selectelPublicBucket(context.env));
    if (!source || !target) return json({ error: 'Selectel S3 не настроен.' }, { status: 503 });
    const object = await fetch(source);
    if (!object.ok || !object.body) return json({ error: 'Сначала загрузите PDF.' }, { status: 409 });
    const copied = await fetch(target, { method: 'PUT', headers: { 'content-type': 'application/pdf' }, body: object.body });
    if (!copied.ok) return json({ error: 'Не удалось опубликовать PDF в Selectel.' }, { status: 502 });
    const coverSource = await selectelUrl(context.env, `pending/${row.storageKey}.cover.jpg`, 'GET');
    const coverTarget = await selectelUrl(context.env, publishedCoverKey, 'PUT', 900, selectelPublicBucket(context.env));
    if (coverSource && coverTarget) {
      const cover = await fetch(coverSource);
      if (cover.ok && cover.body) await fetch(coverTarget, { method: 'PUT', headers: { 'content-type': 'image/jpeg' }, body: cover.body });
    }
    const remove = await selectelUrl(context.env, `pending/${row.storageKey}`, 'DELETE');
    if (remove) await fetch(remove, { method: 'DELETE' });
    const removeCover = await selectelUrl(context.env, `pending/${row.storageKey}.cover.jpg`, 'DELETE');
    if (removeCover) await fetch(removeCover, { method: 'DELETE' });
  } else {
    if (!context.env.ISSUES_BUCKET) return json({ error: 'R2 ещё не подключён.' }, { status: 503 });
    const object = await context.env.ISSUES_BUCKET.head(row.storageKey);
    if (!object) return json({ error: 'Сначала загрузите PDF.' }, { status: 409 });
  }
  const now = new Date().toISOString();
  await context.env.DB.prepare(`UPDATE issue_submissions SET status = 'approved', published_at = ?, updated_at = ? WHERE id = ?`).bind(now, now, row.id).run();
  if (storageMode(context.env) === 'selectel') await updateManifest(context);
  return json({ id: row.id, status: 'approved', publishedAt: now });
}


async function updateManifest(context: any) {
  const { results } = await context.env.DB.prepare(`SELECT id, year, number, serial, date, date_label AS dateLabel, filename, pages FROM issue_submissions WHERE status = 'approved' ORDER BY date ASC`).all();
  const base = String(context.env.SELECTEL_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  const manifest = composeManifest(baseCatalog, results, base);
  const target = await selectelUrl(context.env, 'archive/manifest.json', 'PUT', 900, selectelPublicBucket(context.env));
  if (!target) return;
  await fetch(target, { method: 'PUT', headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' }, body: JSON.stringify(manifest) });
}
