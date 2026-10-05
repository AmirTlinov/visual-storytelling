// Runs inside an opaque sandbox. This adapter has no host SDK, file access or tool capability.
import { adaptScene } from './scene-compat.mjs';
const channel = 'visual-story-scene-v1';
const config = window.__visualStorySession;
let scene,
  hasRendered = false,
  suspended = false,
  stateRevision = config.stateRevision,
  queue = Promise.resolve(),
  reportTimer,
  leaseTimer,
  sampleTimer,
  layoutObserver,
  layoutFrame,
  lastLayout,
  commandController;
const hostRequests = new Map();
const widgetListeners = new Map();
function beforePlay({ signal }) {
  if (config.preview || suspended) throw new Error('This preview cannot play.');
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const finish = (error) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', aborted);
      hostRequests.delete(id);
      error ? reject(error) : resolve();
    };
    const aborted = () => finish(signal.reason ?? new Error('Playback cancelled.'));
    const timer = setTimeout(
      () => finish(new Error('Codex did not confirm playback. Try again.')),
      9000,
    );
    hostRequests.set(id, finish);
    signal?.addEventListener('abort', aborted, { once: true });
    if (signal?.aborted) aborted();
    else send({ type: 'host-request', action: 'focus', id, report: report('play-intent') });
  });
}
const rendered = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const send = (value) =>
  parent.postMessage({ channel, generation: config.generation, ...value }, '*');
function scheduleLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = undefined;
    if (!hasRendered || config.preview || suspended) return;
    const body = document.body;
    // Body height can shrink; document.scrollHeight is at least the iframe viewport height.
    const rect = body.getBoundingClientRect();
    const height = Math.ceil(
      rect.top +
        scrollY +
        Math.max(rect.height, body.scrollHeight) +
        (parseFloat(getComputedStyle(body).marginBottom) || 0),
    );
    const key = `${config.generation}:${height}`;
    if (height > 0 && key !== lastLayout) {
      lastLayout = key;
      send({ type: 'layout', height });
    }
  });
}
const report = (reason, presentation = false) => ({
  state: scene.inspect({ presentation }),
  checkpoint: scene.capture(),
  stateRevision,
  reason,
});
function renew() {
  clearTimeout(leaseTimer);
  leaseTimer = setTimeout(() => {
    scene?.pause?.();
    suspended = true;
    send({ type: 'expired', message: 'Связь прервалась. Сцена остановлена.' });
  }, 6000);
}
function changed(event) {
  if (!scene || suspended || !event.isTrusted) return;
  stateRevision++;
  commandController?.abort(
    new Error('The user changed the scene during this command. Inspect before continuing.'),
  );
  clearTimeout(reportTimer);
  reportTimer = setTimeout(async () => {
    await rendered();
    if (!suspended) send({ type: 'report', report: report('input') });
  }, 32);
}
for (const type of ['input', 'change', 'pointerdown', 'pointerup', 'wheel', 'keydown'])
  addEventListener(type, changed, { capture: true, passive: true });
addEventListener('scene-selection', () => {
  if (!hasRendered || suspended || commandController) return;
  stateRevision++;
  void rendered().then(() => {
    if (!suspended) send({ type: 'report', report: report('selection') });
  });
});
addEventListener('scene-history', () => {
  if (hasRendered && !suspended && !commandController)
    void rendered().then(() => send({ type: 'report', report: report('history') }));
});
addEventListener('message', (event) => {
  if (
    event.source !== parent ||
    event.data?.channel !== channel ||
    event.data.generation !== config.generation
  )
    return;
  if (event.data.type === 'host-response') {
    hostRequests.get(event.data.id)?.(event.data.error ? new Error(event.data.error) : undefined);
    return;
  }
  if (event.data.type === 'activate') {
    config.generation = event.data.nextGeneration;
    config.preview = false;
    stateRevision = event.data.stateRevision;
    config.widgetState = event.data.widgetState ?? {};
    for (const [id, listeners] of widgetListeners)
      if (Object.hasOwn(config.widgetState, id))
        for (const notify of listeners) notify(config.widgetState[id]);
    queue = queue
      .then(async () => {
        if (event.data.checkpoint) await scene.restore(event.data.checkpoint);
        await rendered();
        scheduleLayout();
        renew();
        send({ type: 'ready', report: report('ready') });
      })
      .catch((error) => send({ type: 'error', message: error.message }));
    return;
  }
  if (event.data.type === 'renew') {
    if (!suspended) renew();
    return;
  }
  if (event.data.type === 'theme') {
    config.theme = event.data.value;
    scene?.setTheme?.(config.theme);
    return;
  }
  if (event.data.type !== 'command') return;
  const request = event.data.command;
  const pauseOnly = request.op === 'control' && request.commands.every((c) => c.type === 'pause');
  if (request.op === 'park' || request.op === 'suspend' || pauseOnly) {
    if (!scene || (suspended && request.op !== 'suspend') || Date.now() > request.expiresAt) {
      send({ type: 'ack', id: request.id, error: 'View is unavailable or command expired.' });
      return;
    }
    // Playback arbitration must interrupt a play waiting in the command queue.
    if (request.op === 'suspend') {
      suspended = true;
      clearTimeout(leaseTimer);
    }
    scene?.pause?.();
    commandController?.abort(new Error('Playback moved to another explanation.'));
    stateRevision++;
    void rendered().then(() => {
      send({ type: 'ack', id: request.id, report: report('pause') });
      if (request.op === 'suspend') {
        scene.dispose();
        scene = undefined;
      }
    });
    return;
  }
  queue = queue
    .then(async () => {
      try {
        if (!scene || suspended || Date.now() > request.expiresAt)
          throw new Error('View is unavailable or command expired. Inspect again.');
        if (request.op === 'control' && request.stateRevision !== stateRevision)
          throw new Error(
            'The user changed the scene. Inspect the latest state before controlling it.',
          );
        let result;
        if (request.op === 'control') {
          commandController = new AbortController();
          const controller = commandController;
          const deadline = setTimeout(
            () => {
              scene?.pause?.();
              controller.abort(
                new Error(
                  'Command expired before the scene completed it. Inspect before retrying.',
                ),
              );
            },
            Math.max(0, request.expiresAt - Date.now()),
          );
          try {
            await scene.control(request.commands, { signal: controller.signal });
          } finally {
            clearTimeout(deadline);
            commandController = undefined;
            stateRevision++;
          }
        } else if (request.op === 'find') result = scene.find(request.query);
        else if (request.op !== 'inspect') throw new Error('Unknown view operation');
        await rendered();
        const current = report(request.op, request.detail === 'presentation');
        send({ type: 'ack', id: request.id, report: current, result: result ?? current.state });
      } catch (error) {
        send({
          type: 'ack',
          id: request.id,
          error: error.message,
          report: scene && !suspended ? report('error') : undefined,
        });
      }
    })
    .catch((error) => send({ type: 'error', message: error.message }));
});
async function ready() {
  try {
    await window.galleryReady;
    await document.fonts.ready;
    scene = adaptScene(document.querySelector('.ve-scene')?.scene);
    if (!scene?.inspect || !scene.capture)
      throw new Error('Scene needs the current SceneHandle. Rebuild it with Visual Storytelling.');
    scene.pause?.();
    scene.connectHost?.({
      beforePlay,
      widgetState: {
        read: (id) => config.widgetState?.[id],
        save: (id, snapshot) => {
          config.widgetState = { ...config.widgetState, [id]: snapshot };
          send({ type: 'widget-state', id, snapshot });
        },
        subscribe: (id, listener) => {
          const listeners = widgetListeners.get(id) ?? new Set();
          widgetListeners.set(id, listeners);
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
            if (!listeners.size) widgetListeners.delete(id);
          };
        },
      },
    });
    if (config.theme) scene.setTheme?.(config.theme);
    if (config.checkpoint) await scene.restore(config.checkpoint);
    await rendered();
    hasRendered = true;
    layoutObserver = new ResizeObserver(scheduleLayout);
    layoutObserver.observe(document.body);
    if (!config.preview) renew();
    send({ type: 'ready', report: report('ready') });
    sampleTimer = setInterval(() => {
      if (!suspended && scene.inspect({ presentation: false }).playing)
        send({ type: 'report', report: report('playback') });
    }, 1000);
  } catch (error) {
    send({ type: 'error', message: error.message });
  }
}
if (document.readyState === 'complete') void ready();
else addEventListener('load', ready, { once: true });
addEventListener('pagehide', () => {
  clearTimeout(leaseTimer);
  clearTimeout(reportTimer);
  clearInterval(sampleTimer);
  layoutObserver?.disconnect();
  cancelAnimationFrame(layoutFrame);
  scene?.dispose();
});
addEventListener('error', (event) => send({ type: 'error', message: event.message }));
addEventListener('unhandledrejection', (event) =>
  send({ type: 'error', message: event.reason?.message ?? String(event.reason) }),
);
