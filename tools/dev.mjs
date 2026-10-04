import { existsSync, watch } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildScene } from './build-pages.mjs';
import { sceneInput } from './assets.mjs';
import { serve } from './site.mjs';

import { readFile } from 'node:fs/promises';
import { contentDigest } from './build-info.mjs';
import { previewSessions } from './dev-session.mjs';
import { prepareNarration } from './narration.mjs';
import { parse } from 'parse5';
const clientSource = await readFile(new URL('./dev-client.mjs', import.meta.url));
const client = (revision) =>
  `<script type="module" src="/__visual_story_client.mjs" data-visual-story-client data-revision="${revision ?? ''}"></script>`;
function attachClient(html, revision) {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const body = document.childNodes
    .find((n) => n.tagName === 'html')
    ?.childNodes.find((n) => n.tagName === 'body');
  const offset = body?.sourceCodeLocation?.endTag?.startOffset ?? html.length;
  return html.slice(0, offset) + client(revision) + html.slice(offset);
}

/** Reuse the production builder; publish only a complete successful revision. */
export async function develop(
  directory,
  port = 8793,
  { build: builder = buildScene, watch: extraWatch = [], output, ...buildOptions } = {},
) {
  const source = resolve(directory),
    destination = output ? resolve(output) : join(source, 'dist');
  const clients = new Set(),
    sessions = previewSessions();
  let revision;
  let hasBuild = existsSync(join(destination, 'index.html'));
  let closed = false,
    dirty = false,
    timer,
    running,
    buildError;
  const broadcast = (event, data) => {
    for (const response of clients)
      response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  async function rebuild() {
    dirty = true;
    if (running) return running;
    running = (async () => {
      while (dirty && !closed) {
        dirty = false;
        try {
          await prepareNarration(source);
          await builder(source, destination, buildOptions);
          revision = await contentDigest(destination, ['.']);
          const receipt = { revision, builtAt: new Date().toISOString() };
          sessions.publish(receipt);
          hasBuild = true;
          buildError = undefined;
          broadcast('built', receipt);
        } catch (error) {
          buildError = error.message;
          sessions.fail(buildError);
          broadcast('build-error', error.message);
          console.error(error.message);
        }
      }
    })().finally(() => {
      running = undefined;
    });
    return running;
  }
  if (hasBuild) {
    revision = await contentDigest(destination, ['.']);
    sessions.publish({ revision });
  }
  await rebuild();
  const server = await serve(destination, port, {
    html: (html) => attachClient(html, revision),
    async handle(req, res) {
      if (await sessions.handle(req, res)) return true;
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname === '/__visual_story_client.mjs') {
        res
          .writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' })
          .end(clientSource);
        return true;
      }
      if (!hasBuild && (pathname === '/' || pathname === '/index.html')) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(
          `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Сборка сцены</title></head><body>${client(revision)}</body></html>`,
        );
        return true;
      }
      if (pathname !== '/__visual_story_events') return false;
      const detach = sessions.connect(
        new URL(req.url, 'http://localhost').searchParams.get('view'),
        res,
      );
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      if (buildError) res.write(`event: build-error\ndata: ${JSON.stringify(buildError)}\n\n`);
      clients.add(res);
      req.on('close', () => {
        clients.delete(res);
        detach();
      });
      return true;
    },
  });
  const watchers = [source, ...extraWatch].map((directory) =>
    watch(directory, { recursive: true }, (_event, name) => {
      if (!name || !sceneInput(name)) return;
      clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 120);
    }),
  );
  return {
    url: server.url,
    async close() {
      closed = true;
      clearTimeout(timer);
      for (const watcher of watchers) watcher.close();
      await running;
      sessions.dispose();
      for (const response of clients) response.end();
      await server.close();
    },
  };
}
