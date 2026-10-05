// This module is served only by visual-story dev. It delegates to the existing SceneHandle.
const revision = document.querySelector('[data-visual-story-client]').dataset.revision;
const view = crypto.randomUUID(),
  key = 'visual-story:' + location.pathname;
const post = (data) =>
  fetch('/__visual_story_session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ view, revision, ...data }),
  });
let handle,
  restoring = false,
  acknowledged = false,
  failedBuild = false;
const rendered = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const events = new EventSource('/__visual_story_events?view=' + view);
function showError(message, build = false) {
  failedBuild = build;
  let node = document.getElementById('visual-story-build-error');
  if (!node) {
    node = document.createElement('pre');
    node.id = 'visual-story-build-error';
    node.setAttribute('role', 'alert');
    node.style.cssText =
      'position:fixed;inset:auto 8px 8px;z-index:99999;padding:12px;white-space:pre-wrap;background:#321d22;color:#fff;font:13px/1.5 monospace;max-height:35vh;overflow:auto';
    document.body.append(node);
  }
  node.textContent = message;
}
function savePosition() {
  if (handle?.capture) sessionStorage.setItem(key, JSON.stringify(handle.capture()));
}
function refresh() {
  if (restoring) return;
  restoring = true;
  savePosition();
  location.reload();
}
events.addEventListener('built', (event) => {
  const next = JSON.parse(event.data);
  if (failedBuild) {
    document.getElementById('visual-story-build-error')?.remove();
    failedBuild = false;
  }
  if (next.revision === revision) return;
  if (!handle?.inspect?.().playing) refresh();
  else {
    let button = document.getElementById('visual-story-update');
    if (!button) {
      button = document.createElement('button');
      button.id = 'visual-story-update';
      button.textContent = 'Обновить сцену';
      button.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;padding:8px';
      button.onclick = () => {
        handle.pause?.();
        refresh();
      };
      document.body.append(button);
    }
  }
});
events.addEventListener('build-error', (event) =>
  showError('Сборка не удалась. Открытая сцена сохранена.\n' + JSON.parse(event.data), true),
);
let commands = Promise.resolve();
events.addEventListener('request', (event) => {
  commands = commands
    .then(async () => {
      const request = JSON.parse(event.data);
      try {
        if (request.revision !== revision || Date.now() > request.expiresAt || !handle)
          throw new Error('Shown revision changed; inspect the session before retrying');
        let result;
        if (request.op === 'inspect') result = handle.inspect();
        else if (request.op === 'find') result = handle.find(request.query ?? '');
        else if (request.op === 'control') {
          await handle.control(request.commands);
          await rendered();
          result = handle.inspect();
        }
        await post({ op: 'result', id: request.id, result });
      } catch (error) {
        await post({ op: 'result', id: request.id, error: error.message });
      }
    })
    .catch((error) => showError(error.message));
});
events.addEventListener('open', async () => {
  if (acknowledged) await post({ op: 'ready', path: location.pathname });
});
addEventListener('error', (event) => showError(event.message));
addEventListener('unhandledrejection', (event) =>
  showError(event.reason?.message ?? String(event.reason)),
);
async function ready() {
  try {
    await window.galleryReady;
    await document.fonts.ready;
    handle = document.querySelector('.ve-scene')?.scene;
    if (!handle?.inspect) return;
    const stored = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    const state = stored ? JSON.parse(stored) : null,
      query = new URLSearchParams(location.search);
    const capabilities = handle.inspect().capabilities;
    const cue = state?.cue ?? query.get('cue'),
      hasCue =
        capabilities.includes('cue') && cue && handle.review().cues.some((c) => c.id === cue);
    if (cue && !state && !hasCue) throw new Error('Unknown cue: ' + cue);
    const time = state?.time ?? (query.has('t') ? Number(query.get('t')) : undefined);
    if (state) await handle.restore(state);
    else {
      const commands = capabilities.includes('pause') ? [{ type: 'pause' }] : [];
      if (hasCue) commands.push({ type: 'cue', id: cue, progress: 0 });
      else if (Number.isFinite(time) && capabilities.includes('seek'))
        commands.push({ type: 'seek', time: Math.min(handle.duration, Math.max(0, time)) });
      if (commands.length) await handle.control(commands);
    }
    await rendered();
    const current = await fetch('/__visual_story_session').then((r) => r.json());
    if (current.built?.revision !== revision) {
      refresh();
      return;
    }
    acknowledged = true;
    await post({ op: 'ready', path: location.pathname });
    document.documentElement.dataset.visualStoryRevision = revision;
  } catch (error) {
    showError(error.message);
  }
}
if (document.readyState === 'complete') void ready();
else addEventListener('load', ready, { once: true });
addEventListener('pagehide', () => events.close(), { once: true });
