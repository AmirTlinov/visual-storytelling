// Runs inside an opaque sandbox. This adapter has no host SDK, file access or tool capability.
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
  commandController;
const rendered = () =>
  new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const send = (value) =>
  parent.postMessage({ channel, generation: config.generation, ...value }, '*');
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
  if (event.data.type === 'activate') {
    config.generation = event.data.nextGeneration;
    config.preview = false;
    stateRevision = event.data.stateRevision;
    queue = queue
      .then(async () => {
        if (event.data.checkpoint) await scene.restore(event.data.checkpoint);
        await rendered();
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
  queue = queue
    .then(async () => {
      try {
        if (!scene || (suspended && request.op !== 'suspend') || Date.now() > request.expiresAt)
          throw new Error('View is unavailable or command expired. Inspect again.');
        if (request.op === 'control' && request.stateRevision !== stateRevision)
          throw new Error(
            'The user changed the scene. Inspect the latest state before controlling it.',
          );
        let result;
        if (request.op === 'control') {
          commandController = new AbortController();
          try {
            await scene.control(request.commands, { signal: commandController.signal });
          } finally {
            commandController = undefined;
          }
          stateRevision++;
        } else if (request.op === 'find') result = scene.find(request.query);
        else if (request.op === 'suspend') {
          scene.pause?.();
          stateRevision++;
        } else if (request.op !== 'inspect') throw new Error('Unknown view operation');
        await rendered();
        const current = report(request.op, request.detail === 'presentation');
        send({ type: 'ack', id: request.id, report: current, result: result ?? current.state });
        if (request.op === 'suspend') {
          suspended = true;
          clearTimeout(leaseTimer);
          scene.dispose();
        }
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
    scene = document.querySelector('.ve-scene')?.scene;
    if (!scene?.inspect || !scene.capture)
      throw new Error('Scene needs the current SceneHandle. Rebuild it with Visual Storytelling.');
    scene.pause?.();
    if (config.theme) scene.setTheme?.(config.theme);
    if (config.checkpoint) await scene.restore(config.checkpoint);
    await rendered();
    hasRendered = true;
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
  scene?.dispose();
});
addEventListener('error', (event) => send({ type: 'error', message: event.message }));
addEventListener('unhandledrejection', (event) =>
  send({ type: 'error', message: event.reason?.message ?? String(event.reason) }),
);
