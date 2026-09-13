type SelectelConfig = {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
};

const encoder = new TextEncoder();

export function selectelConfig(env: any): SelectelConfig | null {
  const endpoint = String(env.SELECTEL_S3_ENDPOINT ?? '').replace(/\/$/, '');
  const bucket = String(env.SELECTEL_S3_BUCKET ?? '');
  const accessKey = String(env.SELECTEL_S3_ACCESS_KEY ?? '');
  const secretKey = String(env.SELECTEL_S3_SECRET_KEY ?? '');
  if (!endpoint || !bucket || !accessKey || !secretKey) return null;
  return { endpoint, bucket, accessKey, secretKey, region: String(env.SELECTEL_S3_REGION ?? 'ru-3') };
}

const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

function uriPath(value: string) {
  return `/${value.split('/').map(part => encode(part)).join('/')}`;
}

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map(value => value.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string) {
  return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(key: ArrayBuffer | Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
}

async function signingKey(secret: string, date: string, region: string) {
  const dateKey = await hmac(encoder.encode(`AWS4${secret}`), date);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, 's3');
  return hmac(serviceKey, 'aws4_request');
}

export async function selectelUrl(env: any, key: string, method: 'GET' | 'PUT' | 'HEAD' | 'DELETE', expires = 900, bucketOverride?: string, now = new Date()) {
  const config = selectelConfig(env);
  if (!config) return null;
  const endpoint = new URL(config.endpoint);

  const bucket = bucketOverride || config.bucket;
  endpoint.hostname = `${bucket}.${endpoint.hostname}`;
  const host = endpoint.host;
  const path = uriPath(key);
  if (expires < 1 || expires > 604800) throw new Error('Invalid presigned URL lifetime');
  const amzDate = now.toISOString().replace(/[-:]|\.\d{3}/g, '').replace('Z', 'Z');
  const shortDate = amzDate.slice(0, 8);
  const credentialScope = `${shortDate}/${config.region}/s3/aws4_request`;
  const params = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKey}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': 'host',
  });
  const canonicalQuery = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&');
  const canonicalRequest = [method, path, canonicalQuery, `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const signature = hex(await hmac(await signingKey(config.secretKey, shortDate, config.region), ['AWS4-HMAC-SHA256', amzDate, credentialScope, await sha256(canonicalRequest)].join('\n')));
  params.set('X-Amz-Signature', signature);
  return `${endpoint.origin}${path}?${[...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([name, value]) => `${encode(name)}=${encode(value)}`).join('&')}`;
}

export function selectelPublicBucket(env: any) {
  const config = selectelConfig(env);
  return String(env.SELECTEL_S3_PUBLIC_BUCKET ?? config?.bucket ?? '');
}

export function selectelPublicUrl(env: any, key: string) {
  const base = String(env.SELECTEL_PUBLIC_BASE_URL ?? '').replace(/\/$/, '');
  return base ? `${base}/${key.split('/').map(part => encode(part)).join('/')}` : null;
}

export function storageMode(env: any) {
  return selectelConfig(env) ? 'selectel' : 'r2';
}
