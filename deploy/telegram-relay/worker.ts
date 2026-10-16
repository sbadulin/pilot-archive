type Env = {REPORTS_RELAY_KEY: string; TELEGRAM_BOT_TOKEN: string; TELEGRAM_CHAT_ID: string};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: {'content-type': 'application/json', 'cache-control': 'no-store'},
});

async function authorized(request: Request, secret: string): Promise<boolean> {
  if (!secret || secret.length < 32) return false;
  const supplied = request.headers.get('authorization') || '';
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a, b] = await Promise.all([digest(supplied), digest(`Bearer ${secret}`)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

// This relay has one fixed destination and accepts only report text. It never
// receives access logs, visitor IPs, or User-Agents from the Russian server.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!await authorized(request, env.REPORTS_RELAY_KEY)) return json({ok: false}, 401);
    if (!env.TELEGRAM_BOT_TOKEN || !/^-[0-9]+$/.test(env.TELEGRAM_CHAT_ID || '')) return json({ok: false}, 503);
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health') {
      try {
        const upstream = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getMe`, {signal: AbortSignal.timeout(10000)});
        const result = await upstream.json() as {ok?: boolean; result?: {username: string}};
        return result.ok ? json({ok: true, bot: result.result?.username}) : json({ok: false}, 502);
      } catch { return json({ok: false}, 502); }
    }
    if (request.method !== 'POST' || path !== '/send') return json({ok: false}, 404);
    if (Number(request.headers.get('content-length') || 0) > 16000) return json({ok: false}, 413);
    let payload: {text?: unknown};
    try { payload = await request.json(); } catch { return json({ok: false}, 400); }
    if (typeof payload.text !== 'string' || !payload.text.startsWith('Первый Пилот:') || payload.text.length > 3500) {
      return json({ok: false}, 400);
    }
    try {
      const upstream = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: 'POST', headers: {'content-type': 'application/json'},
        body: JSON.stringify({chat_id: env.TELEGRAM_CHAT_ID, text: payload.text, disable_web_page_preview: true}),
        signal: AbortSignal.timeout(15000),
      });
      const result = await upstream.json() as {ok?: boolean; result?: {message_id: number}};
      if (!upstream.ok || !result.ok) return json({ok: false, error: 'telegram'}, 502);
      return json({ok: true, message_id: result.result?.message_id});
    } catch {
      // No raw errors or request bodies: the upstream URL contains the bot token.
      return json({ok: false, error: 'telegram'}, 502);
    }
  },
};
