import { existsSync, watch } from 'node:fs';
import { mkdtemp, rm, rename } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { buildScene } from './build-pages.mjs';
import { serve } from './site.mjs';

// Only the development server injects this client; exported pages stay independent.
const client = `<script type="module">
const key = 'visual-story:' + location.pathname;
let handle;
addEventListener('load', async () => { try {
  await window.galleryReady;
  await document.fonts.ready;
  handle = window.explainer ?? document.querySelector('.ve-scene')?.scene;
  const query = new URLSearchParams(location.search);
  const stored = sessionStorage.getItem(key);
  sessionStorage.removeItem(key);
  const cue = query.get('cue');
  const time = stored !== null ? Number(stored) : cue ? handle?.review?.().cues.find(c => c.id === cue)?.start :
    query.has('t') ? Number(query.get('t')) : undefined;
  if (cue && stored === null && time === undefined) throw new Error('Неизвестная метка: ' + cue + '. Проверьте timeline.json.');
  if (Number.isFinite(time)) { handle?.pause?.(); handle?.seek?.(time); }
} catch (error) { showError(error.message); } });
const events = new EventSource('/__visual_story_events');
events.addEventListener('built', () => {
  const time = handle?.currentTime ?? document.querySelector('[data-seek]')?.value;
  if (time !== undefined) sessionStorage.setItem(key, String(time));
  location.reload();
});
events.addEventListener('build-error', event => showError('Сборка не удалась. Исправьте исходник; сцена обновится автоматически.\\n' + JSON.parse(event.data)));
addEventListener('error', event => showError(event.message));
addEventListener('unhandledrejection', event => showError(event.reason?.message ?? String(event.reason)));
function showError(message) {
  let error = document.getElementById('visual-story-build-error');
  if (!error) {
    error = document.createElement('pre'); error.id = 'visual-story-build-error';
    error.setAttribute('role', 'alert');
    error.style.cssText = 'position:fixed;inset:auto 8px 8px;z-index:99999;padding:12px;white-space:pre-wrap;background:#321d22;color:#fff;font:13px/1.5 monospace;max-height:35vh;overflow:auto';
    document.body.append(error);
  }
  error.textContent = message;
}
</script>`;

/** Reuse the production builder; publish only a complete successful revision. */
export async function develop(directory, port = 8793, buildOptions = {}) {
  const source = resolve(directory),
    destination = join(source, 'dist');
  const clients = new Set();
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
        const staging = await mkdtemp(join(source, '.visual-story-build-'));
        try {
          await buildScene(source, staging, buildOptions);
          await rm(destination, { recursive: true, force: true });
          await rename(staging, destination);
          hasBuild = true;
          buildError = undefined;
          broadcast('built', null);
        } catch (error) {
          buildError = error.message;
          broadcast('build-error', error.message);
          console.error(error.message);
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
      }
    })().finally(() => {
      running = undefined;
    });
    return running;
  }
  await rebuild();
  const server = await serve(destination, port, {
    html: (html) => html.replace('</body>', `${client}</body>`),
    handle(req, res) {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (!hasBuild && (pathname === '/' || pathname === '/index.html')) {
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(
          `<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Сборка сцены</title></head><body>${client}</body></html>`,
        );
        return true;
      }
      if (req.url !== '/__visual_story_events') return false;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
      });
      res.write(': connected\n\n');
      if (buildError) res.write(`event: build-error\ndata: ${JSON.stringify(buildError)}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return true;
    },
  });
  const ignored = new Set(['node_modules', 'dist', 'site', 'artifacts', 'review', '__pycache__']);
  const watcher = watch(source, { recursive: true }, (_event, name) => {
    if (!name || name.split(sep).some((part) => part.startsWith('.') || ignored.has(part))) return;
    clearTimeout(timer);
    timer = setTimeout(() => void rebuild(), 120);
  });
  return {
    url: server.url,
    async close() {
      closed = true;
      clearTimeout(timer);
      watcher.close();
      await running;
      for (const response of clients) response.end();
      await server.close();
    },
  };
}
