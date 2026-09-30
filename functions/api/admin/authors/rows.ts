import { requireCurator, json } from '../../_lib/auth';

const PAGE = 2000;

// Credits for the search index, a page at a time: the curator's browser builds the index,
// because a Function on the free plan has too little CPU to do it for the whole archive.
export async function onRequestGet(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  const after = new URL(context.request.url).searchParams.get('after') ?? '';
  const { results } = await context.env.DB.prepare(
    `SELECT id, issue_year AS year, issue_number AS number, issue_serial AS serial, printed_page AS page, kind, title, name, name_key AS nameKey
     FROM credits WHERE status != 'hidden' AND id > ? ORDER BY id LIMIT ?`,
  ).bind(after, PAGE).all();
  return json({ rows: results, next: results.length === PAGE ? results[results.length - 1].id : null });
}
