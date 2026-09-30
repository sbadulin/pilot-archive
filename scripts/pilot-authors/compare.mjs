// Run several models over the pilot issues' editorial pages, then score each against the references.
// Usage: node compare.mjs <work-dir> <model>...
// <work-dir> holds pages/<issue>/p-NN.jpg and ref/<issue>.json; outputs go to out/<model-slug>/<issue>.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const [work, ...models] = process.argv.slice(2);
const here = new URL('.', import.meta.url).pathname;
// Pager and TV-programme sheets are left for a separate run.
const ISSUES = { i11: [1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 16, 17, 18, 19], i12: [1, 2, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 16, 17, 18, 19], i26: [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18] };

for (const model of models) {
  // TAG separates runs made with different prompts.
  const slug = model.replace(/[^a-z0-9.-]+/gi, '_') + (process.env.TAG ? `-${process.env.TAG}` : '');
  for (const [issue, pages] of Object.entries(ISSUES)) {
    const out = `${work}/out/${slug}/${issue}`;
    const todo = pages.map((p) => `p-${String(p).padStart(2, '0')}`).filter((p) => !existsSync(`${out}/${p}.json`)).map((p) => `${work}/pages/${issue}/${p}.jpg`);
    if (todo.length) execFileSync('node', [`${here}vision.mjs`, model, out, ...todo], { stdio: 'inherit' });
  }
  for (const issue of Object.keys(ISSUES)) {
    execFileSync('node', [`${here}eval.mjs`, `${work}/ref/${issue}.json`, `${work}/out/${slug}/${issue}`, '--skip-kinds=pager,ads,other', '--names'], { stdio: 'inherit' });
  }
}
