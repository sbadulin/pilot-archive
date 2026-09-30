import { identity, json } from '../_lib/auth';

// Who is signed in through Cloudflare Access, so the admin UI shows curator tools only to curators.
export async function onRequestGet(context: any) {
  const { email, role } = identity(context);
  return json({ email, role });
}
