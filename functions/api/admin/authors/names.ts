import { requireCurator, json } from '../../_lib/auth';

// Every recognized name with how many materials it signed, for the curator's list.
export async function onRequestGet(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  const { results } = await context.env.DB.prepare(
    `SELECT name, name_key AS key, COUNT(*) AS count, SUM(status = 'hidden') AS hidden FROM credits GROUP BY name ORDER BY name_key`,
  ).all();
  return json({ names: results });
}
