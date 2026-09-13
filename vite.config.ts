import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

export default defineConfig({
  plugins: [react(), {
    name: 'local-archive-and-pdf-assets',
    configureServer(server) {
      for (const [prefix, folder] of [['/archive/', 'archive-data/archive'], ['/pdfjs/', 'node_modules/pdfjs-dist']] as const) {
        server.middlewares.use(prefix, async (req, res, next) => {
          try {
            const suffix = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\//, '');
            const root = resolve(folder);
            const file = resolve(root, prefix === '/pdfjs/' && suffix === 'pdf.worker.min.mjs' ? `build/${suffix}` : suffix);
            if (!file.startsWith(root + sep)) { res.statusCode = 403; res.end(); return; }
            const body = await readFile(file);
            const type = file.endsWith('.mjs') ? 'text/javascript' : file.endsWith('.json') ? 'application/json' : file.endsWith('.pdf') ? 'application/pdf' : file.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
            res.setHeader('Content-Type', type);
            res.setHeader('Accept-Ranges', 'bytes');
            const range = req.headers.range?.match(/^bytes=(\d+)-(\d*)$/);
            if (range) {
              const start = Number(range[1]), end = Math.min(range[2] ? Number(range[2]) : body.length - 1, body.length - 1);
              if (start > end) { res.statusCode = 416; res.setHeader('Content-Range', `bytes */${body.length}`); res.end(); return; }
              res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${body.length}`); res.end(body.subarray(start, end + 1));
            } else res.end(body);
          } catch { next(); }
        });
      }
    },
  }],
  server: { host: '127.0.0.1', port: 4173, strictPort: true },
});
