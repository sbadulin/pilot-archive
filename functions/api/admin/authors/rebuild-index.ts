import { requireCurator, json } from '../../_lib/auth';
import { publishAuthorsIndex } from '../../_lib/authorsPublish';

// Curator action after importing recognized credits or correcting them.
export async function onRequestPost(context: any) {
  const denied = requireCurator(context);
  if (denied instanceof Response) return denied;
  if (!context.env.DB) return json({ error: 'D1 ещё не подключён.' }, { status: 503 });
  const published = await publishAuthorsIndex(context);
  if (!published) return json({ error: 'Не удалось опубликовать индекс авторов в Selectel.' }, { status: 502 });
  return json(published);
}
