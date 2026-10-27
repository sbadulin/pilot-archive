// Uploads a file to the public Selectel bucket the way scripts/publish-redacted.mjs does: from abroad a
// PUT to Selectel crawls, so the file goes to the Russian server by scp, the server PUTs it to a
// staging key in the private bucket over a presigned URL (no Selectel keys on the server), and a
// server-side copy puts it at the public key with the given Cache-Control.
// Needs AWS_* credentials for Selectel (AWS_PROFILE=selectel, AWS_CA_BUNDLE) and SSH to the relay
// (PILOT_RELAY, PILOT_RELAY_KEY).
import { execFileSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const endpoint = process.env.SELECTEL_ENDPOINT ?? 'https://s3.ru-6.storage.selcloud.ru';
export const bucket = process.env.SELECTEL_PUBLIC_BUCKET ?? 'pilot-archive-public';
const privateBucket = process.env.SELECTEL_PRIVATE_BUCKET ?? 'pilot-archive-issues-private';
export const publicBase = (process.env.SELECTEL_PUBLIC_BASE_URL ?? 'https://pilot-archive.ru').replace(/\/$/, '');
const relay = process.env.PILOT_RELAY ?? 'root@135.106.210.25';
const relayKey = process.env.PILOT_RELAY_KEY ?? join(homedir(), '.ssh/pilot_archive_gateway');
const ssh = ['-i', relayKey, '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', '-o', 'LogLevel=ERROR'];

// aws cli v2 ships its own Python with botocore inside; presign-put.py signs PUT URLs with it.
let awsPython;
const python = () => (awsPython ??= process.env.AWS_CLI_PYTHON ??
  join(dirname(realpathSync(execFileSync('which', ['aws'], { encoding: 'utf8' }).trim())), 'python'));
const aws = (...rest) => execFileSync('aws', ['--endpoint-url', endpoint, ...rest], { encoding: 'utf8' });

export function relayUpload(file, key, type, cacheControl) {
  const size = statSync(file).size;
  const staging = `staging/${key}`;
  const remote = `/tmp/relay-${key.replaceAll('/', '_')}`;
  execFileSync('scp', ['-q', ...ssh, file, `${relay}:${remote}`], { stdio: 'pipe' });
  const url = execFileSync(python(), [join(import.meta.dirname, 'presign-put.py'), privateBucket, staging, type], { encoding: 'utf8' }).trim();
  const code = execFileSync('ssh', [...ssh, relay,
    `curl -s -o /dev/null -w '%{http_code}' -T ${remote} -H 'Content-Type: ${type}' '${url}'; rm -f ${remote}`], { encoding: 'utf8' }).trim();
  if (code !== '200') throw new Error(`${key}: PUT from ${relay} answered ${code}`);
  aws('s3api', 'copy-object', '--bucket', bucket, '--key', key, '--copy-source', `${privateBucket}/${staging}`,
    '--metadata-directive', 'REPLACE', '--content-type', type, '--cache-control', cacheControl);
  aws('s3api', 'delete-object', '--bucket', privateBucket, '--key', staging);
  const uploaded = JSON.parse(aws('s3api', 'head-object', '--bucket', bucket, '--key', key)).ContentLength;
  if (uploaded !== size) throw new Error(`${key}: uploaded ${uploaded} bytes, expected ${size}`);
}

/** Keys already in the public bucket under a prefix, with their sizes. */
export function listPublic(prefix) {
  const out = aws('s3api', 'list-objects-v2', '--bucket', bucket, '--prefix', prefix, '--query', 'Contents[].[Key,Size]', '--output', 'json');
  return new Map((JSON.parse(out) ?? []).map(([key, size]) => [key, size]));
}
