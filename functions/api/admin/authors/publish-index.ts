import { requireCurator, json } from '../../_lib/auth';
import { selectelPublicBucket, selectelUrl, storageMode } from '../../_lib/selectel';

// Publish the search index the curator's browser built. The body is copied to the public
// Selectel bucket as bytes, never parsed, so it costs the Function almost no CPU.
export async function onRequestPost(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  if (storageMode(context.env) !== 'selectel') return json({ error: 'Поиск публикуется только в Selectel.' }, { status: 503 });
  // A presigned PUT needs a known length, so the body is buffered rather than streamed.
  const body = await context.request.arrayBuffer();
  if (!body.byteLength || body.byteLength > 50 * 1024 * 1024) return json({ error: 'Нужен индекс поиска.' }, { status: 400 });
  const target = await selectelUrl(context.env, 'archive/authors-index.json', 'PUT', 900, selectelPublicBucket(context.env));
  if (!target) return json({ error: 'Selectel S3 не настроен.' }, { status: 503 });
  const put = await fetch(target, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' },
    body,
  });
  if (!put.ok) return json({ error: `Не удалось опубликовать поиск в Selectel: ${put.status}` }, { status: 502 });
  return json({ published: true });
}
