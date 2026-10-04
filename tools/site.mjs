import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
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
      const info = await stat(file);
      if (!info.isFile()) {
        res.writeHead(404).end('Not found');
        return;
      }
      const bytes =
        html && file.endsWith('.html')
          ? Buffer.from(html(await readFile(file, 'utf8')))
          : undefined;
      const size = bytes?.length ?? info.size;
      res.setHeader('Content-Type', mediaType(file));
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'no-store');
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      let start = 0,
        end = size - 1;
      if (range) {
        start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        end = range[1] && range[2] ? Math.min(size - 1, Number(range[2])) : size - 1;
        if (
          (!range[1] && !range[2]) ||
          !Number.isSafeInteger(start) ||
          !Number.isSafeInteger(end) ||
          start > end
        ) {
          res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
          return;
        }
        res.writeHead(206, {
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': end - start + 1,
        });
      } else {
        res.writeHead(200, { 'Content-Length': size });
      }
      if (req.method === 'HEAD' || !size) res.end();
      else if (bytes) res.end(bytes.subarray(start, end + 1));
      else await pipeline(createReadStream(file, { start, end }), res);
    } catch {
      if (res.headersSent) res.destroy();
      else res.writeHead(404).end('Not found');
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
