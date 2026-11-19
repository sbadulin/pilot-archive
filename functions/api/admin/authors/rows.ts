import { requireCurator, json } from '../../_lib/auth';

const PAGE = 2000;

// Credits for the search index, a page at a time: the curator's browser builds the index,
// because a Function on the free plan has too little CPU to do it for the whole archive.
// A staged issue has its credits before approval (scripts/local-credits.mjs); they stay out of
// the public index until it is approved. Issues of the base catalog have no submission row.
export async function onRequestGet(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  const after = new URL(context.request.url).searchParams.get('after') ?? '';
  const { results } = await context.env.DB.prepare(
    `SELECT id, issue_year AS year, issue_number AS number, issue_serial AS serial, printed_page AS page, kind, title, name, name_key AS nameKey
     FROM credits WHERE status != 'hidden' AND id > ?
       AND NOT (EXISTS (SELECT 1 FROM issue_submissions s WHERE s.year = credits.issue_year AND s.number = credits.issue_number
             AND s.serial = credits.issue_serial AND s.status = 'pending')
         AND NOT EXISTS (SELECT 1 FROM issue_submissions s WHERE s.year = credits.issue_year AND s.number = credits.issue_number
             AND s.serial = credits.issue_serial AND s.status = 'approved'))
     ORDER BY id LIMIT ?`,
  ).bind(after, PAGE).all();
  return json({ rows: results, next: results.length === PAGE ? results[results.length - 1].id : null });
}
