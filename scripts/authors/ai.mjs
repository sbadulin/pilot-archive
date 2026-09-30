// REST access to Cloudflare AI for the local recognition scripts; the recognition itself
// (prompt, Gemini → Claude fallback) is shared with the approval flow in functions/api/_lib/recognition.ts.
// Auth: CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID), or the local `wrangler login` token.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { recognizeSheet as recognize } from '../../functions/api/_lib/recognition.ts';

const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || 'f8ae082199efcca3522f5735982edee9';
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai`;

function token() {
  if (process.env.CLOUDFLARE_API_TOKEN) return process.env.CLOUDFLARE_API_TOKEN;
  const cfg = readFileSync(`${homedir()}/Library/Preferences/.wrangler/config/default.toml`, 'utf8');
  const m = cfg.match(/^oauth_token\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error('No Cloudflare token: set CLOUDFLARE_API_TOKEN or run `wrangler login`');
  return m[1];
}

async function post(path, body, attempt = 0) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  // The `wrangler login` token lives about an hour; any wrangler command refreshes it.
  if (res.status === 401 && !process.env.CLOUDFLARE_API_TOKEN && attempt === 0) {
    execFileSync('npx', ['--no-install', 'wrangler', 'whoami'], { stdio: 'ignore' });
    return post(path, body, attempt + 1);
  }
  // The gateway rate-limits third-party models; back off and retry.
  if ((res.status === 429 || res.status >= 500) && attempt < 6) {
    await new Promise((r) => setTimeout(r, 5000 * 2 ** attempt));
    return post(path, body, attempt + 1);
  }
  if (!res.ok || json.success === false || json.type === 'error')
    throw new Error(`${body.model}: ${res.status} ${JSON.stringify(json.errors ?? json.error ?? json).slice(0, 300)}`);
  return json.result ?? json;
}

// Same shape as the env.AI binding in Functions.
const rest = {
  run: (model, input) => (model.startsWith('anthropic/') ? post('/v1/messages', { model, ...input }) : post('/run', { model, input })),
};

export async function recognizeSheet(jpeg) {
  return { status: 'ok', ...(await recognize(rest, jpeg.toString('base64'))) };
}
