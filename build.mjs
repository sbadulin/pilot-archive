import { build } from 'esbuild';
import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const out = resolve(process.argv.includes('--admin') ? 'dist-admin' : 'dist');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp('public', out, { recursive: true });
for (const asset of ['pdf.worker.min.mjs']) {
  await mkdir(`${out}/pdfjs`, { recursive: true });
  await cp(`node_modules/pdfjs-dist/build/${asset}`, `${out}/pdfjs/${asset}`);
}
for (const dir of ['cmaps', 'standard_fonts', 'wasm']) await cp(`node_modules/pdfjs-dist/${dir}`, `${out}/pdfjs/${dir}`, { recursive: true });
const result = await build({ metafile: true, entryPoints: ['src/main.tsx'], bundle: true, splitting: true, format: 'esm', outdir: out, entryNames: 'assets/app-[hash]', chunkNames: 'chunks/[name]-[hash]', assetNames: 'assets/[name]-[hash]', minify: true, jsx: 'automatic', loader: { '.woff2': 'file', '.woff': 'file' }, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'info', target: ['es2022'] });
let html = await readFile(`${out}/index.html`, 'utf8');
if (!html.includes('runtime-config.js')) throw new Error('Runtime configuration missing from production HTML');
const [entry, details] = Object.entries(result.metafile.outputs).find(([, data]) => data.entryPoint === 'src/main.tsx');
html = html.replace('/app.js', '/' + relative(out, resolve(entry))).replace('/app.css', '/' + relative(out, resolve(details.cssBundle)));
await writeFile(`${out}/index.html`, html);
if (process.argv.includes('--admin')) await writeFile(`${out}/runtime-config.js`, "window.PILOT_ADMIN_ORIGIN = 'https://pilot-archive.pages.dev';\nwindow.PILOT_ARCHIVE_ORIGIN = 'https://pilot-archive.ru';\nwindow.PILOT_MANIFEST_URL = 'https://pilot-archive.ru/archive/manifest.json';\n");
