const allowedOrigins = new Set(['https://pilot-archive.ru', 'https://pilot-archive.pages.dev']);

function corsHeaders(request: Request) {
  const origin = request.headers.get('origin');
  const headers = new Headers({
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-allow-credentials': 'true',
    vary: 'Origin',
  });
  if (origin && allowedOrigins.has(origin)) headers.set('access-control-allow-origin', origin);
  return headers;
}

export async function onRequest(context: any) {
  if (context.request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(context.request) });
  const response = await context.next();
  const headers = new Headers(response.headers);
  for (const [name, value] of corsHeaders(context.request)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
