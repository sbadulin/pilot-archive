import { requireCurator, json } from '../../_lib/auth';
import { publishAuthorsIndex } from '../../_lib/authorsPublish';

// Hide a wrongly recognized credit from the site search, or bring it back.
export async function onRequestPost(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  let input: any;
  try { input = await context.request.json(); } catch { return json({ error: 'Ожидался JSON: { status }.' }, { status: 400 }); }
  const status = input?.status;
  if (status !== 'hidden' && status !== 'auto' && status !== 'confirmed') return json({ error: 'Неизвестный статус.' }, { status: 400 });
  const result = await context.env.DB.prepare(`UPDATE credits SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, new Date().toISOString(), context.params.id).run();
  if (!result.meta?.changes) return json({ error: 'Запись не найдена.' }, { status: 404 });
  const published = await publishAuthorsIndex(context);
  return json({ id: context.params.id, status, published: Boolean(published) });
}
