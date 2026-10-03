import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { mediaType } from './assets.mjs';
export async function serve(directory = 'site', port = 0, { handle, html } = {}) {
  const root = resolve(directory);
  const server = createServer(async (req, res) => {
    try {
      if (await handle?.(req, res)) return;
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(root + sep)) {
        res.writeHead(403).end();
        return;
      }
      let bytes = await readFile(file);
      if (html && file.endsWith('.html')) bytes = Buffer.from(html(bytes.toString()));
      res.setHeader('Content-Type', mediaType(file));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store');
      const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
      if (range) {
        const start = Number(range[1]),
          end = Math.min(bytes.length - 1, range[2] ? Number(range[2]) : bytes.length - 1);
        if (start > end) {
          res.writeHead(416).end();
          return;
        }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
          'Content-Length': end - start + 1,
        });
        res.end(bytes.subarray(start, end + 1));
      } else {
        res.writeHead(200, { 'Content-Length': bytes.length });
        res.end(bytes);
      }
    } catch {
      res.writeHead(404).end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
}
