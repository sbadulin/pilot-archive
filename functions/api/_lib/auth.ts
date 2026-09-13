import { canPublish, canSubmit, roleForEmail, type SubmissionRole } from '../../../src/ingestion';

export function identity(context: any): { email: string | null; role: SubmissionRole | null } {
  const email = context.request.headers.get('cf-access-authenticated-user-email');
  return { email, role: roleForEmail(email, context.env) };
}

export function requireSubmitter(context: any) {
  const user = identity(context);
  if (!user.email || !canSubmit(user.role)) return new Response(JSON.stringify({ error: 'Сначала войдите через Cloudflare Access.' }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } });
  return user;
}

export function requireCurator(context: any) {
  const user = identity(context);
  if (!user.email || !canPublish(user.role)) return new Response(JSON.stringify({ error: 'Только куратор может менять статус выпуска.' }), { status: 403, headers: { 'content-type': 'application/json; charset=utf-8' } });
  return user;
}

export function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), { ...init, headers: { 'content-type': 'application/json; charset=utf-8', ...init.headers } });
}
