import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const items = JSON.parse(await readFile('archive-data/checksums.json', 'utf8'));
for (const item of items) {
  const pdf = await readFile(`archive-data/archive/${item.year}/${item.slug}/issue.pdf`);
  if (pdf.length !== item.bytes || createHash('sha256').update(pdf).digest('hex') !== item.sha256) throw new Error(`PDF checksum mismatch: ${item.slug}`);
  if (!pdf.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error(`Invalid PDF: ${item.slug}`);
  await readFile(`archive-data/archive/${item.year}/${item.slug}/cover.jpg`);
}
console.log(`Verified ${items.length} original PDFs and covers.`);
