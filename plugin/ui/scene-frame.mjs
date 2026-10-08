// Runs inside an opaque sandbox. This adapter has no host SDK, file access or tool capability.
import { adaptScene } from './scene-compat.mjs';
import { presentSession } from '../mcp/presentation.mjs';
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
  commandController,
  renderStatus = 'prepared',
  observationError,
  disposed = false;
const gestures = new Set();
const hostRequests = new Map();
const widgetListeners = new Map();
let preparedReplacement;
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
const completed = (pending, signal) => {
  signal?.throwIfAborted();
  if (!signal) return pending;
  return new Promise((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve(pending)
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', aborted));
  });
};
const rendered = async (signal) => {
  await completed(scene?.ready?.(), signal);
  renderStatus = await completed(
    new Promise((resolve) => {
      let frame;
      const finish = (status) => {
        clearTimeout(timer);
        cancelAnimationFrame(frame);
        resolve(status);
      };
      // Native hosts can stop iframe RAF even while visibilityState remains "visible".
      // The scene is prepared; distinguish this from an observed repaint opportunity.
      const timer = setTimeout(() => finish('prepared'), 150);
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => finish('rendered'));
      });
    }),
    signal,
  );
  observationError = undefined;
};
const send = (value) => {
  if (!disposed) parent.postMessage({ channel, generation: config.generation, ...value }, '*');
};
async function acknowledge(request, reason) {
  const controller = new AbortController();
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error('Command expired while preparing the paused scene. Inspect before retrying.'),
      ),
    Math.max(0, request.expiresAt - Date.now()),
  );
  try {
    await rendered(controller.signal);
    if (!disposed) send({ type: 'ack', id: request.id, report: report(reason) });
  } catch (error) {
    // Pausing already succeeded. A broken preparation must not make stop unavailable.
    send({ type: 'ack', id: request.id, report: failedReport(error, reason) });
  } finally {
    clearTimeout(timer);
  }
}
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
const report = (reason, detail = 'state') => {
  let checkpoint;
  try {
    checkpoint = scene.capture();
  } catch (error) {
    if (error.code !== 'scene_not_presented') throw error;
  }
  return {
    state: presentSession(
      { state: scene.inspect({ presentation: detail === 'presentation' }) },
      detail,
    ).state,
    checkpoint,
    stateRevision,
    renderStatus,
    observationError,
    reason,
  };
};
function failedReport(error, reason, detail) {
  // These are the accepted runtime inputs, not a completed or displayed frame.
  // Publishing their revision is essential for inspect -> corrective control.
  renderStatus = 'failed';
  observationError = String(error?.message ?? error).slice(0, 4096);
  return report(reason, detail === 'presentation' ? 'state' : detail);
}
function renew() {
  clearTimeout(leaseTimer);
  leaseTimer = setTimeout(() => {
    scene?.pause?.();
    suspended = true;
    document.body.inert = true;
    send({ type: 'expired', message: 'Связь прервалась. Сцена остановлена.' });
  }, 6000);
}
function changed(event) {
  if (!scene || suspended || !event.isTrusted) return;
  if (event.type === 'pointerdown') gestures.add(event.pointerId);
  if (event.type === 'pointerup' || event.type === 'pointercancel')
    gestures.delete(event.pointerId);
  stateRevision++;
  commandController?.abort(
    new Error('The user changed the scene during this command. Inspect before continuing.'),
  );
  clearTimeout(reportTimer);
  reportTimer = setTimeout(() => void observe('input'), 32);
}
async function observe(reason) {
  try {
    await rendered();
    if (scene && !suspended) send({ type: 'report', report: report(reason) });
  } catch (error) {
    if (scene && !suspended) {
      send({ type: 'report', report: failedReport(error, reason) });
      send({ type: 'error', message: observationError });
    }
  }
}
for (const type of [
  'input',
  'change',
  'pointerdown',
  'pointerup',
  'pointercancel',
  'wheel',
  'keydown',
])
  addEventListener(type, changed, { capture: true, passive: true });
addEventListener('lostpointercapture', (event) => gestures.delete(event.pointerId));
addEventListener('blur', () => gestures.clear());
addEventListener('scene-selection', () => {
  if (!hasRendered || suspended || commandController) return;
  stateRevision++;
  void observe('selection');
});
addEventListener('scene-history', () => {
  if (hasRendered && !suspended && !commandController) void observe('history');
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
  if (event.data.type === 'restore-preview') {
    if (!config.preview || !scene) return;
    const request = event.data;
    queue = queue
      .then(async () => {
        const controller = new AbortController();
        const deadline = setTimeout(
          () => controller.abort(new Error('Preview restoration expired.')),
          Math.max(0, request.expiresAt - Date.now()),
        );
        try {
          preparedReplacement = undefined;
          stateRevision = request.stateRevision;
          config.widgetState = request.widgetState ?? {};
          for (const [id, listeners] of widgetListeners)
            if (Object.hasOwn(config.widgetState, id))
              for (const notify of listeners) notify(config.widgetState[id]);
          if (request.checkpoint)
            await completed(scene.restore(request.checkpoint), controller.signal);
          await rendered(controller.signal);
          preparedReplacement = request.replacementId;
          send({ type: 'preview-restored', replacementId: request.replacementId });
        } finally {
          clearTimeout(deadline);
        }
      })
      .catch((error) =>
        send({
          type: 'preview-error',
          replacementId: request.replacementId,
          message: error.message,
        }),
      );
    return;
  }
  if (event.data.type === 'activate') {
    if (!config.preview || preparedReplacement !== event.data.replacementId) {
      send({ type: 'error', message: 'The candidate did not confirm its restored state.' });
      return;
    }
    // Preparation already restored and awaited this checkpoint. Promotion is synchronous.
    config.generation = event.data.nextGeneration;
    config.preview = false;
    stateRevision = event.data.stateRevision;
    scheduleLayout();
    renew();
    send({ type: 'ready', report: report('ready') });
    return;
  }
  if (event.data.type === 'renew') {
    if (!suspended) renew();
    return;
  }
  if (event.data.type === 'theme') {
    config.theme = event.data.value;
    void Promise.resolve(scene?.setTheme?.(config.theme)).catch((error) =>
      send({ type: 'error', message: error.message }),
    );
    return;
  }
  if (event.data.type !== 'command') return;
  const request = event.data.command;
  if (request.op === 'capture') {
    try {
      if (!scene || suspended || Date.now() > request.expiresAt)
        throw new Error(
          'The displayed scene is unavailable. Restore its connection before saving it.',
        );
      send({
        type: 'ack',
        id: request.id,
        result: {
          checkpoint: scene.capture(),
          viewport: {
            width: innerWidth,
            height: innerHeight,
            theme:
              config.theme ??
              (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'),
          },
        },
      });
    } catch (error) {
      send({ type: 'ack', id: request.id, error: error.message });
    }
    return;
  }
  const pauseOnly = request.op === 'control' && request.commands.every((c) => c.type === 'pause');
  if (request.op === 'resume') {
    if (!scene || Date.now() > request.expiresAt) {
      send({ type: 'ack', id: request.id, error: 'View is unavailable or command expired.' });
      return;
    }
    suspended = false;
    document.body.inert = false;
    renew();
    void acknowledge(request, 'resume');
    return;
  }
  if (request.op === 'park' || request.op === 'suspend' || pauseOnly) {
    if (!scene || (suspended && request.op !== 'suspend') || Date.now() > request.expiresAt) {
      send({ type: 'ack', id: request.id, error: 'View is unavailable or command expired.' });
      return;
    }
    // Playback arbitration must interrupt a play waiting in the command queue.
    if (request.op === 'suspend') {
      suspended = true;
      document.body.inert = true;
      clearTimeout(leaseTimer);
    }
    scene?.pause?.();
    commandController?.abort(new Error('Playback moved to another explanation.'));
    stateRevision++;
    void acknowledge(request, 'pause');
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
        if (request.op === 'control' && gestures.size)
          throw new Error('The user is adjusting the scene. Wait for the gesture to finish.');
        commandController = new AbortController();
        const controller = commandController;
        const deadline = setTimeout(
          () => {
            scene?.pause?.();
            controller.abort(
              new Error('Command expired before the scene completed it. Inspect before retrying.'),
            );
          },
          Math.max(0, request.expiresAt - Date.now()),
        );
        let result;
        try {
          if (request.op === 'control') {
            try {
              await scene.control(request.commands, { signal: controller.signal });
            } finally {
              stateRevision++;
            }
          } else if (request.op === 'find') {
            await completed(scene.ready?.(), controller.signal);
            result = scene.find(request.query);
          } else if (request.op !== 'inspect') throw new Error('Unknown view operation');
          await rendered(controller.signal);
          const current = report(request.op, request.detail);
          send({ type: 'ack', id: request.id, report: current, result });
        } finally {
          clearTimeout(deadline);
          commandController = undefined;
        }
      } catch (error) {
        send({
          type: 'ack',
          id: request.id,
          report: scene ? failedReport(error, request.op, request.detail) : undefined,
          error: request.op === 'inspect' && scene ? undefined : String(error?.message ?? error),
          failure: error?.code?.startsWith('scene_control_')
            ? {
                code: error.code,
                commandIndex: error.commandIndex,
                completedCommands: error.completedCommands,
              }
            : undefined,
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
    if (config.theme) await scene.setTheme?.(config.theme);
    if (config.checkpoint) await scene.restore(config.checkpoint);
    await rendered();
    hasRendered = true;
    layoutObserver = new ResizeObserver(scheduleLayout);
    layoutObserver.observe(document.body);
    if (!config.preview) renew();
    send({ type: 'ready', report: report('ready') });
    let sampling = false;
    sampleTimer = setInterval(() => {
      if (!suspended && !sampling && scene.inspect({ presentation: false }).playing) {
        sampling = true;
        void observe('playback').finally(() => {
          sampling = false;
        });
      }
    }, 1000);
  } catch (error) {
    send({ type: 'error', message: error.message });
  }
}
if (document.readyState === 'complete') void ready();
else addEventListener('load', ready, { once: true });
addEventListener('pagehide', () => {
  disposed = true;
  commandController?.abort(new Error('View closed.'));
  clearTimeout(leaseTimer);
  clearTimeout(reportTimer);
  clearInterval(sampleTimer);
  layoutObserver?.disconnect();
  cancelAnimationFrame(layoutFrame);
  scene?.dispose();
  scene = undefined;
});
addEventListener('error', (event) => send({ type: 'error', message: event.message }));
addEventListener('unhandledrejection', (event) =>
  send({ type: 'error', message: event.reason?.message ?? String(event.reason) }),
);
