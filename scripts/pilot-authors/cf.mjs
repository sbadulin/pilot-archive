// Minimal Workers AI REST client for the authors pilot.
// Auth: CLOUDFLARE_API_TOKEN, or the local `wrangler login` OAuth token as a fallback.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || 'f8ae082199efcca3522f5735982edee9';

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const cfg = readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, 'utf8');
  const m = cfg.match(/^oauth_token\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error('No Cloudflare token: set CLOUDFLARE_API_TOKEN or run `wrangler login`');
  return m[1];
}

export async function run(model, input, attempt = 0) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, input }),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
    return run(model, input, attempt + 1);
  }
  if (!res.ok || body.success === false) throw new Error(`${model}: ${res.status} ${JSON.stringify(body.errors ?? body).slice(0, 400)}`);
  return body.result;
}

// Third-party Anthropic models, billed through the account's AI Gateway balance.
export async function messages(body, attempt = 0) {
  const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/v1/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  // Gateway rate limits third-party models; back off and retry.
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
    return messages(body, attempt + 1);
  }
  if (!res.ok || json.type === 'error' || json.success === false) throw new Error(`${body.model}: ${res.status} ${JSON.stringify(json.error ?? json.errors ?? json).slice(0, 400)}`);
  return json.result ?? json;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [model, json] = process.argv.slice(2);
  console.log(JSON.stringify(await run(model, JSON.parse(json)), null, 2));
}
