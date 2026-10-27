// Publishes the «Пейджер» section data: pager-site.json from the cache root (npm run pager:site)
// goes to the public bucket as archive/pager.json, next to manifest.json and authors-index.json.
//
//   npm run pager:publish                 # plan only, uploads nothing
//   npm run pager:publish -- --apply      # uploads
//   npm run pager:publish -- --cache <dir>
//
// Uploads the same way as scripts/publish-redacted.mjs: from abroad a PUT to Selectel crawls, so
// the file goes to the Russian server by scp, the server PUTs it to a staging key in the private
// bucket over a presigned URL (no Selectel keys on the server), and a server-side copy puts it at
// the public key with Cache-Control: no-cache (the site re-checks it on every visit, like the
// authors index). Needs AWS_* credentials for Selectel and SSH to the relay (PILOT_RELAY, PILOT_RELAY_KEY).
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const endpoint = process.env.SELECTEL_ENDPOINT ?? 'https://s3.ru-6.storage.selcloud.ru';
const bucket = process.env.SELECTEL_PUBLIC_BUCKET ?? 'pilot-archive-public';
const privateBucket = process.env.SELECTEL_PRIVATE_BUCKET ?? 'pilot-archive-issues-private';
const publicBase = (process.env.SELECTEL_PUBLIC_BASE_URL ?? 'https://pilot-archive.ru').replace(/\/$/, '');
const cacheRoot = option('cache', join(process.env.PILOT_ARCHIVE_ROOT ?? join(homedir(), 'Downloads/Reading'), 'pilot-archive-fulltext-cache'));
const relay = process.env.PILOT_RELAY ?? 'root@135.106.210.25';
const relayKey = process.env.PILOT_RELAY_KEY ?? join(homedir(), '.ssh/pilot_archive_gateway');
const key = 'archive/pager.json';
const type = 'application/json';
const cacheControl = 'no-cache';

const file = join(cacheRoot, 'pager-site.json');
const site = JSON.parse(readFileSync(file, 'utf8'));
if (site.version !== 1 || !Array.isArray(site.messages) || !Array.isArray(site.profiles) || !site.dates) {
  throw new Error(`${file} is not a pager-site.json (run npm run pager:site)`);
}
// Fail closed: held and retold messages must never reach the site, whatever produced the file.
if (site.messages.some((message) => message.hold || /^\s*\[пересказ\]/iu.test(message.text))) {
  throw new Error(`${file} contains held or retold messages; rebuild it with npm run pager:site`);
}
const size = statSync(file).size;
console.log(`${file}: ${site.messages.length} messages, ${site.profiles.length} profiles, ${(size / 1024).toFixed(0)} KB`);
console.log(`→ s3://${bucket}/${key} (${type}, Cache-Control: ${cacheControl}) = ${publicBase}/${key}`);
if (!apply) {
  console.log('Nothing uploaded. Re-run with --apply to publish.');
  process.exit(0);
}

// aws cli v2 ships its own Python with botocore inside; presign-put.py signs PUT URLs with it.
const awsPython = process.env.AWS_CLI_PYTHON ??
  join(dirname(realpathSync(execFileSync('which', ['aws'], { encoding: 'utf8' }).trim())), 'python');
const aws = (...rest) => execFileSync('aws', ['--endpoint-url', endpoint, ...rest], { encoding: 'utf8' });
const ssh = ['-i', relayKey, '-o', 'BatchMode=yes', '-o', 'ServerAliveInterval=30', '-o', 'LogLevel=ERROR'];
const staging = `staging/${key}`;
const remote = `/tmp/relay-${key.replaceAll('/', '_')}`;
execFileSync('scp', ['-q', ...ssh, file, `${relay}:${remote}`], { stdio: 'pipe' });
const url = execFileSync(awsPython, [join(import.meta.dirname, 'presign-put.py'), privateBucket, staging, type], { encoding: 'utf8' }).trim();
const code = execFileSync('ssh', [...ssh, relay,
  `curl -s -o /dev/null -w '%{http_code}' -T ${remote} -H 'Content-Type: ${type}' '${url}'; rm -f ${remote}`], { encoding: 'utf8' }).trim();
if (code !== '200') throw new Error(`${key}: PUT from ${relay} answered ${code}`);
aws('s3api', 'copy-object', '--bucket', bucket, '--key', key, '--copy-source', `${privateBucket}/${staging}`,
  '--metadata-directive', 'REPLACE', '--content-type', type, '--cache-control', cacheControl);
aws('s3api', 'delete-object', '--bucket', privateBucket, '--key', staging);
const uploaded = JSON.parse(aws('s3api', 'head-object', '--bucket', bucket, '--key', key)).ContentLength;
if (uploaded !== size) throw new Error(`${key}: uploaded ${uploaded} bytes, expected ${size}`);
console.log(`Published ${publicBase}/${key}`);
