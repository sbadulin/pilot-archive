// Publish archive/authors-index.json to the public Selectel bucket from production D1 —
// the same result as the admin «Обновить поиск на сайте» button, from a local machine.
// Needs `wrangler login` and the `selectel` AWS profile.
// Usage: node --experimental-strip-types scripts/authors/publish-index.mjs [--dry-run]
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { composeAuthorsIndex } from '../../functions/api/_lib/authorsIndex.ts';

const ENDPOINT = process.env.SELECTEL_ENDPOINT ?? 'https://s3.ru-6.storage.selcloud.ru';
const BUCKET = process.env.SELECTEL_PUBLIC_BUCKET ?? 'pilot-archive-public';

const query = `SELECT issue_year AS year, issue_number AS number, issue_serial AS serial, printed_page AS page, kind, title, name, name_key AS nameKey FROM credits WHERE status != 'hidden'`;
const raw = execFileSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', 'pilot_archive', '--remote', '--json', '--command', query], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const rows = JSON.parse(raw)[0].results;
const index = composeAuthorsIndex(rows);
const file = join(tmpdir(), 'authors-index.json');
writeFileSync(file, JSON.stringify(index));
console.log(`${rows.length} credits → ${index.names.length} names`);

if (!process.argv.includes('--dry-run')) {
  execFileSync('aws', ['--profile', 'selectel', '--endpoint-url', ENDPOINT, 's3', 'cp', file, `s3://${BUCKET}/archive/authors-index.json`,
    '--content-type', 'application/json', '--cache-control', 'no-cache'], { stdio: 'inherit', env: { ...process.env, AWS_CA_BUNDLE: process.env.AWS_CA_BUNDLE ?? '/etc/ssl/cert.pem' } });
}
