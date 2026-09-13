import { selectelPublicBucket, selectelUrl, storageMode } from '../../_lib/selectel';

export async function onRequestGet(context: any) {
  if (!context.env.DB) return new Response('Storage is not configured', { status: 503 });
  const row = await context.env.DB.prepare(`SELECT storage_key AS storageKey, status FROM issue_submissions WHERE id = ?`).bind(context.params.id).first();
  if (!row || row.status !== 'approved') return new Response('Not found', { status: 404 });
  if (storageMode(context.env) === 'selectel') {
    const url = await selectelUrl(context.env, `published/${row.storageKey}`, 'GET', 900, selectelPublicBucket(context.env));
    if (!url) return new Response('Storage is not configured', { status: 503 });
    const response = await fetch(url);
    if (!response.ok) return new Response('Not found', { status: response.status === 404 ? 404 : 502 });
    return new Response(response.body, { headers: { 'content-type': 'application/pdf', 'cache-control': 'public, max-age=31536000, immutable' } });
  }
  if (!context.env.ISSUES_BUCKET) return new Response('Storage is not configured', { status: 503 });
  const object = await context.env.ISSUES_BUCKET.get(row.storageKey);
  if (!object) return new Response('Not found', { status: 404 });
  return new Response(object.body, { headers: { 'content-type': object.httpMetadata?.contentType ?? 'application/pdf', 'cache-control': 'public, max-age=31536000, immutable', etag: object.httpEtag } });
}
