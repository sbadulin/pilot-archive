import { selectelPublicBucket, selectelUrl } from './selectel';
import { composeAuthorsIndex, type CreditRow } from './authorsIndex';

// Rebuild archive/authors-index.json in the public bucket from D1, like archive/manifest.json.
export async function publishAuthorsIndex(context: any): Promise<{ names: number } | null> {
  const { results } = await context.env.DB.prepare(
    `SELECT issue_year AS year, issue_number AS number, issue_serial AS serial, printed_page AS page, kind, title, name, name_key AS nameKey
     FROM credits WHERE status != 'hidden'`,
  ).all();
  const index = composeAuthorsIndex(results as CreditRow[]);
  const target = await selectelUrl(context.env, 'archive/authors-index.json', 'PUT', 900, selectelPublicBucket(context.env));
  if (!target) return null;
  const put = await fetch(target, { method: 'PUT', headers: { 'content-type': 'application/json', 'cache-control': 'no-cache' }, body: JSON.stringify(index) });
  return put.ok ? { names: index.names.length } : null;
}
