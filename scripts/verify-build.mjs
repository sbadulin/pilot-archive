import { readdir, readFile, stat } from 'node:fs/promises';
async function list(dir) { return (await Promise.all((await readdir(dir, { withFileTypes: true })).map(e => e.isDirectory() ? list(`${dir}/${e.name}`) : `${dir}/${e.name}`))).flat(); }
for (const dir of ['dist','dist-admin']) {
  const files = await list(dir);
  if (files.some(f => /\.(pdf|jpg)$/.test(f) || f.includes('/archive/'))) throw new Error('Archive leaked into frontend build');
  const html = await readFile(`${dir}/index.html`, 'utf8');
  if (/https:\/\/(cdn.jsdelivr|fonts.googleapis)/.test(html) || !html.includes('runtime-config.js')) throw new Error('External dependency or missing configuration');
  for (const m of html.matchAll(/(?:src|href)="(\/[^"#]+)"/g)) await stat(dir + m[1]);
  const bytes = (await Promise.all(files.map(f => stat(f)))).reduce((sum,s)=>sum+s.size,0);
  console.log(`${dir}: ${files.length} files, ${(bytes/1024/1024).toFixed(2)} MiB; no PDFs or page images.`);
}
