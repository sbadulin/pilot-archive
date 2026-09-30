import { requireCurator, json } from '../../_lib/auth';
import { publishAuthorsIndex } from '../../_lib/authorsPublish';
import { normalizeName } from '../../../../src/authorNames';

// Rename every credit signed with one name. Renaming to a name that already exists merges them.
// The correction is kept in name_fixes, so re-recognizing an issue does not bring the old name back.
export async function onRequestPost(context: any) {
  const user = requireCurator(context);
  if (user instanceof Response) return user;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  let input: any;
  try { input = await context.request.json(); } catch { return json({ error: 'Ожидался JSON: { from, to }.' }, { status: 400 }); }
  const from = String(input?.from ?? '').trim();
  const to = String(input?.to ?? '').replace(/\s+/g, ' ').trim();
  const toKey = normalizeName(to);
  if (!from || !toKey || to.length > 200) return json({ error: 'Укажите новое имя.' }, { status: 400 });
  if (from === to) return json({ updated: 0 });
  const now = new Date().toISOString();
  const db = context.env.DB;
  const [renamed] = await db.batch([
    db.prepare(`UPDATE credits SET name = ?, name_key = ?, updated_at = ? WHERE name = ?`).bind(to, toKey, now, from),
    db.prepare(`INSERT INTO name_fixes (wrong, "right", right_key, created_by, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(wrong) DO UPDATE SET "right" = excluded."right", right_key = excluded.right_key, created_by = excluded.created_by, created_at = excluded.created_at`)
      .bind(from, to, toKey, user.email, now),
    // Earlier corrections that pointed at the old name now point at the new one.
    db.prepare(`UPDATE name_fixes SET "right" = ?, right_key = ? WHERE "right" = ?`).bind(to, toKey, from),
    // Renaming back to a recognized spelling leaves nothing to correct.
    db.prepare(`DELETE FROM name_fixes WHERE wrong = "right"`),
  ]);
  const published = await publishAuthorsIndex(context);
  return json({ updated: renamed.meta?.changes ?? 0, published: Boolean(published) });
}
