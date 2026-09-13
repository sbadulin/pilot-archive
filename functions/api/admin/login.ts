import { requireSubmitter } from '../_lib/auth';

export async function onRequestGet(context: any) {
  const user = requireSubmitter(context);
  if (user instanceof Response) return user;
  const requestUrl = new URL(context.request.url);
  const requestedReturn = requestUrl.searchParams.get('return') || '/#add';
  const returnPath = requestedReturn.startsWith('/') ? requestedReturn : '/#add';
  const roleReturnPath = user.role === 'curator' ? `${returnPath}${returnPath.includes('?') ? '&' : '?'}role=curator` : returnPath;
  const returnUrl = `${requestUrl.origin}${roleReturnPath}`;
  return new Response(`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Доступ подтверждён · Первый Пилот</title><body style="font-family:system-ui,sans-serif;max-width:38rem;margin:4rem auto;padding:0 1.5rem;line-height:1.5"><h1>Доступ подтверждён</h1><p>Вы вошли как <strong>${escapeHtml(user.email || '')}</strong>. Вернитесь к форме, чтобы отправить выпуск.</p><p><a href="${escapeHtml(returnUrl)}">Вернуться к добавлению выпуска</a></p></body></html>`, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character] || character));
}
