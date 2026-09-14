import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('archive-catalog/manifest.json', 'utf8'));
const checksums = JSON.parse(await readFile('archive-catalog/checksums.json', 'utf8'));
const issues = manifest.issues ?? [];
if (!Array.isArray(issues) || !Array.isArray(checksums)) throw new Error('Invalid archive catalog');
const issueKeys = new Set();
for (const issue of issues) {
  const key = `${issue.year}/${issue.slug}`;
  if (issueKeys.has(key)) throw new Error(`Duplicate issue: ${key}`);
  issueKeys.add(key);
  for (const field of ['id', 'year', 'slug', 'number', 'serial', 'date', 'pages', 'pdfUrl', 'coverUrl']) {
    if (issue[field] === undefined || issue[field] === null || issue[field] === '') throw new Error(`Missing ${field}: ${key}`);
  }
}
const checksumKeys = new Set();
for (const item of checksums) {
  const key = `${item.year}/${item.slug}`;
  if (checksumKeys.has(key)) throw new Error(`Duplicate checksum: ${key}`);
  checksumKeys.add(key);
  if (!Number.isInteger(item.bytes) || item.bytes <= 0 || !/^[a-f0-9]{64}$/.test(item.sha256)) throw new Error(`Invalid checksum metadata: ${key}`);
}
if (issueKeys.size !== checksumKeys.size || [...issueKeys].some(key => !checksumKeys.has(key))) throw new Error('Manifest and checksum catalogs do not match');
console.log(`Verified catalog metadata for ${issues.length} original PDFs; binaries live in Selectel S3.`);
