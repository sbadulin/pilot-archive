import { requireCurator, json } from '../../_lib/auth';

// Materials signed by one name, with the byline as printed so the curator can check it.
export async function onRequestGet(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  const name = new URL(context.request.url).searchParams.get('name');
  if (!name) return json({ error: 'Укажите имя.' }, { status: 400 });
  const { results } = await context.env.DB.prepare(
    `SELECT id, issue_year AS year, issue_number AS number, issue_serial AS serial, printed_page AS page, kind, title, byline, status
     FROM credits WHERE name = ? ORDER BY issue_year, issue_number, printed_page`,
  ).bind(name).all();
  return json({ credits: results });
}
