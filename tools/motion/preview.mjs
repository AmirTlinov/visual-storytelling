import { readFile, realpath } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { serve } from '../site.mjs';
import { loadCapture } from './session.mjs';

const within = (folder, file) =>
  file === folder || file.startsWith(folder.endsWith(sep) ? folder : folder + sep);

/** Serve a report and its explicit media references through the existing static server. */
export async function previewReport(directory, port = 0) {
  const report = await realpath(directory);
  const session = await readFile(join(report, 'session.json'), 'utf8').then(
    (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return undefined;
      }
    },
    (error) => {
      if (error.code !== 'ENOENT') throw error;
    },
  );
  // Source projects and ordinary built scenes retain their normal preview root.
  if (session?.kind !== 'visual-review-session') return serve(report, port);

  const capture = await loadCapture(report);
  const files = new Set(capture.samples.map((frame) => frame.file));
  if (capture.context?.audio)
    files.add(resolve(dirname(capture.captureManifest), '..', capture.context.audio));
  const media = new Map(
    await Promise.all([...files].map(async (file) => [file, await realpath(file)])),
  );
  let root = report;
  for (const file of files)
    while (!within(root, file)) {
      const parent = dirname(root);
      if (parent === root) throw new Error('Report media must share a filesystem root for preview');
      root = parent;
    }
  const server = await serve(root, port, {
    async handle(req, res) {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
      // A common URL root is not permission to expose its neighbours. Also reject
      // report-local symlinks escaping the report, and changed media symlink targets.
      if (within(report, file) || media.has(file)) {
        const actual = await realpath(file).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        if (!actual || within(report, actual) || media.get(file) === actual) return false;
      }
      res.writeHead(403).end('Outside this report and its captured media');
      return true;
    },
  });
  return {
    ...server,
    url:
      root === report
        ? server.url
        : `${server.url}/${relative(root, join(report, 'index.html')).split(sep).map(encodeURIComponent).join('/')}`,
  };
}
