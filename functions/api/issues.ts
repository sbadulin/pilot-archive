import { json } from './_lib/auth';

export async function onRequestGet(context: any) {
  if (!context.env.DB) return json({ issues: [], configured: false });
  const { results } = await context.env.DB.prepare(`SELECT id, year, number, serial, date, date_label AS dateLabel, filename, pages, status, published_at AS publishedAt FROM issue_submissions WHERE status = 'approved' ORDER BY date ASC`).all();
  return json({ issues: results, configured: true });
}
