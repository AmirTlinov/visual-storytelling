import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import manifest from '../../plugin.json' with { type: 'json' };
import { sceneDocument } from './scene-document.mjs';
import { frameContext } from './frame-context.mjs';
import { libraryUI } from './library.mjs';
import { preferencesUI } from './preferences.mjs';
import { fileEntrypoint } from './file-entrypoint.mjs';
import { voiceUI } from './voice.mjs';

const app = new App({ name: 'Visual Storytelling', version: manifest.version });
const extensions = new OpenAIExtensions(app);
let modelContext = frameContext(app, extensions);
const $ = (id) => document.getElementById(id);
let frame = $('scene'),
  candidate,
  preparing,
  failedRevision,
  replacing = false;
const renderer = crypto.randomUUID(),
  channel = 'visual-story-scene-v1';
let session,
  report,
  closed = false,
  polling = false,
  loadTimer;
let pollingDone = Promise.resolve();
let updates = Promise.resolve();
function sync(acknowledgement) {
  const current = report,
    owner = session;
  updates = updates
    .then(async () => {
      if (closed || session !== owner) return;
      await call('exchange', {
        report: current,
        acknowledgements: acknowledgement ? [acknowledgement] : [],
        wait: false,
      });
    })
    .catch((e) => {
      if (!closed && session === owner) error(e.message);
    });
}
function error(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}
const send = (value) =>
  frame.contentWindow?.postMessage({ channel, generation: session?.generation, ...value }, '*');
async function call(action, args = {}) {
  const result = await app.callServerTool({
    name: 'story_view',
    arguments: {
      action,
      sessionId: session?.sessionId,
      renderer,
      generation: session?.generation,
      ...args,
    },
  });
  if (result.isError)
    throw new Error(result.content?.find((c) => c.type === 'text')?.text ?? 'Connection failed');
  return result;
}
const publishContext = () => {
  if (session && report && !closed) modelContext.update(session, report);
};
async function poll() {
  if (polling || closed || !session) return;
  polling = true;
  let done;
  pollingDone = new Promise((resolve) => {
    done = resolve;
  });
  while (!closed) {
    const generation = session.generation;
    try {
      const result = await call('exchange');
      if (closed) break;
      if (generation !== session.generation) continue;
      send({ type: 'renew' });
      for (const command of result.structuredContent.commands) send({ type: 'command', command });
      updateJobs(result.structuredContent.jobs ?? []);
      if (result.structuredContent.navigation) {
        closed = true;
        const destination = result.structuredContent.navigation;
        queueMicrotask(
          () => void open({ structuredContent: destination }).catch((e) => error(e.message)),
        );
        break;
      }
      if (result.structuredContent.update)
        void prepareUpdate(result.structuredContent.update).catch((e) => error(e.message));
    } catch (e) {
      if (closed) break;
      if (generation !== session.generation) continue;
      if (replacing) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      error(e.message);
      $('connection').textContent = 'Сцена остановлена';
      send({
        type: 'command',
        command: { op: 'suspend', id: crypto.randomUUID(), expiresAt: Date.now() + 1000 },
      });
      closed = true;
      await modelContext.close();
    }
  }
  polling = false;
  done();
}
async function mount(result) {
  if (!result.structuredContent?.sessionId || session) return;
  error('');
  session = result.structuredContent;
  $('connection').textContent = 'Открываю сцену…';
  const attached = await call('attach');
  session = attached.structuredContent;
  library.update(session);
  voice.update();
  $('back').hidden = !session.returnAvailable;
  $('title').textContent = session.title;
  updateJobs(session.jobs ?? []);
  const config = {
    theme: app.getHostContext()?.theme,
    generation: session.generation,
    checkpoint: session.checkpoint,
    stateRevision: session.stateRevision,
    widgetState: session.widgetState,
  };
  if (attached._meta.sceneHTML) {
    frame.srcdoc = sceneDocument(attached._meta.sceneHTML, config);
    loadTimer = setTimeout(
      () => error('Сцена не загрузилась. Закройте и откройте её снова.'),
      10000,
    );
  }
  void poll();
}
async function prepareUpdate(update) {
  if (
    preparing ||
    replacing ||
    failedRevision === update.buildRevision ||
    candidate?.revision === update.buildRevision
  )
    return;
  const owner = session;
  preparing = true;
  try {
    const result = await call('candidate');
    if (closed || session !== owner) return;
    const next = result.structuredContent;
    clearTimeout(candidate?.timer);
    candidate?.frame.remove();
    const preview = frame.cloneNode(false);
    preview.removeAttribute('id');
    preview.setAttribute('aria-hidden', 'true');
    preview.tabIndex = -1;
    preview.className = 'candidate';
    frame.after(preview);
    candidate = { frame: preview, revision: next.revision, generation: -Date.now(), ready: false };
    candidate.timer = setTimeout(
      () => failCandidate('Истекло время загрузки. Проверьте исходники сцены.'),
      15000,
    );
    preview.srcdoc = sceneDocument(result._meta.sceneHTML, {
      theme: app.getHostContext()?.theme,
      preview: true,
      generation: candidate.generation,
      checkpoint: next.checkpoint,
      stateRevision: next.stateRevision,
      widgetState: next.widgetState,
    });
  } finally {
    preparing = false;
  }
}
function failCandidate(message) {
  if (!candidate) return;
  candidate.restoration?.reject(new Error(message));
  failedRevision = candidate.revision;
  clearTimeout(candidate.timer);
  candidate.frame.remove();
  candidate = null;
  $('update').hidden = true;
  error('Новая версия не готова: ' + message);
}
async function applyUpdate() {
  if (!candidate?.ready || replacing) return;
  const next = candidate;
  const owner = session;
  const operation = {
    sessionId: owner.sessionId,
    generation: owner.generation,
    buildRevision: next.revision,
  };
  let prepared;
  replacing = true;
  $('update').disabled = true;
  try {
    prepared = (await call('replace', { ...operation, phase: 'prepare' })).structuredContent;
    if (closed || session !== owner || candidate !== next)
      throw new Error('Представление закрылось во время подготовки.');
    await new Promise((resolve, reject) => {
      let timer;
      const finish = (fn) => (value) => {
        clearTimeout(timer);
        next.restoration = undefined;
        fn(value);
      };
      next.restoration = {
        id: prepared.replacementId,
        resolve: finish(resolve),
        reject: finish(reject),
      };
      timer = setTimeout(
        () => next.restoration?.reject(new Error('Истекло время переноса состояния.')),
        Math.max(0, prepared.expiresAt - Date.now()),
      );
      next.frame.contentWindow.postMessage(
        {
          channel,
          generation: next.generation,
          type: 'restore-preview',
          replacementId: prepared.replacementId,
          expiresAt: prepared.expiresAt,
          checkpoint: prepared.checkpoint,
          stateRevision: prepared.stateRevision,
          widgetState: prepared.widgetState,
        },
        '*',
      );
    });
    if (closed || session !== owner || candidate !== next)
      throw new Error('Представление закрылось во время подготовки.');
    const result = await call('replace', {
      ...operation,
      phase: 'commit',
      replacementId: prepared.replacementId,
    });
    if (closed || session !== owner || candidate !== next) return;
    session = result.structuredContent;
    const old = frame;
    frame = next.frame;
    old.id = '';
    frame.id = 'scene';
    frame.className = '';
    frame.removeAttribute('aria-hidden');
    frame.removeAttribute('tabindex');
    frame.contentWindow.postMessage(
      {
        channel,
        generation: next.generation,
        type: 'activate',
        replacementId: prepared.replacementId,
        nextGeneration: session.generation,
        stateRevision: session.stateRevision,
      },
      '*',
    );
    candidate = null;
    old.remove();
    $('update').hidden = true;
    error('');
  } catch (e) {
    if (prepared)
      await call('replace', {
        ...operation,
        phase: 'abort',
        replacementId: prepared.replacementId,
      }).catch(() => {});
    if (candidate === next) failCandidate(e.message);
    else if (!closed && session?.sessionId === owner.sessionId) error(e.message);
  } finally {
    replacing = false;
    $('update').disabled = false;
    void poll();
  }
}
function updateJobs(jobs) {
  const active = jobs.find((j) => ['queued', 'running', 'cancelling'].includes(j.status));
  $('job').hidden = !active;
  if (active) {
    $('job-text').textContent =
      active.stage + (active.progress ? ` ${active.progress.done} / ${active.progress.total}` : '');
    $('cancel').disabled = active.status === 'cancelling';
    $('cancel').onclick = () =>
      void app.callServerTool({ name: 'story_cancel', arguments: { jobId: active.id } });
  }
  const last = jobs[0];
  $('retry').hidden = !last || !['failed', 'cancelled', 'interrupted'].includes(last.status);
  $('retry').onclick = async () => {
    $('retry').disabled = true;
    try {
      const result = await app.callServerTool({
        name: 'story_retry',
        arguments: { jobId: last.id, requestId: crypto.randomUUID() },
      });
      if (result.isError) throw new Error(result.content[0].text);
      error('');
    } catch (e) {
      error(e.message);
    } finally {
      $('retry').disabled = false;
    }
  };
  if (last?.status === 'failed') error(last.error);
  if (last?.status === 'succeeded' && last.result?.files) {
    library.artifacts(last.result.files);
  }
}
$('update').onclick = () => void applyUpdate();
addEventListener('message', (event) => {
  const data = event.data;
  if (
    event.source === candidate?.frame.contentWindow &&
    data?.channel === channel &&
    data.generation === candidate.generation
  ) {
    if (data.type === 'preview-restored' && data.replacementId === candidate.restoration?.id)
      candidate.restoration.resolve();
    if (data.type === 'preview-error' && data.replacementId === candidate.restoration?.id)
      candidate.restoration.reject(new Error(data.message));
    if (data.type === 'error') failCandidate(data.message);
    if (data.type === 'ready') {
      clearTimeout(candidate.timer);
      candidate.ready = true;
      $('update').hidden = false;
      if (!report?.state.playing) void applyUpdate();
    }
    return;
  }
  if (
    event.source !== frame.contentWindow ||
    data?.channel !== channel ||
    data.generation !== session?.generation
  )
    return;
  if (data.type === 'layout') {
    if (
      document.documentElement.dataset.mode !== 'fullscreen' &&
      Number.isFinite(data.height) &&
      data.height > 0
    )
      frame.style.setProperty('--scene-height', `${Math.ceil(data.height)}px`);
    return;
  }
  if (data.report) report = data.report;
  if (data.type === 'widget-state') {
    void call('widget', { widget: { id: data.id, snapshot: data.snapshot } }).catch((e) =>
      error(e.message),
    );
    return;
  }
  if (data.type === 'host-request') {
    if (data.action === 'focus') {
      void call('focus', { report: data.report }).then(
        () => send({ type: 'host-response', id: data.id }),
        (e) => send({ type: 'host-response', id: data.id, error: e.message }),
      );
    }
    return;
  }
  if (data.type === 'ready') {
    $('connection').textContent = 'Готово';
    clearTimeout(loadTimer);
    const notices = report.state.restoreNotices?.map((notice) => notice.message) ?? [];
    if (report.state.compatibility?.message) notices.push(report.state.compatibility.message);
    $('notice').textContent = [...new Set(notices)].join(' ');
    $('notice').hidden = !notices.length;
    sync();
    void publishContext();
  }
  if (data.type === 'report') {
    if (data.report.reason === 'input') $('notice').hidden = true;
    sync();
    void publishContext();
  }
  if (data.type === 'ack') {
    sync({ id: data.id, result: data.result, error: data.error, failure: data.failure });
    void publishContext();
  }
  if (data.type === 'error' || data.type === 'expired') {
    error(data.message);
    $('connection').textContent = 'Сцена остановлена';
  }
  if (candidate?.ready && !report?.state.playing) void applyUpdate();
});
$('expand').onclick = async () => {
  const mode = document.documentElement.dataset.mode === 'fullscreen' ? 'inline' : 'fullscreen';
  if ($('expand').disabled || !app.getHostContext()?.availableDisplayModes?.includes(mode)) return;
  $('expand').disabled = true;
  try {
    const result = await app.requestDisplayMode({ mode });
    host({ displayMode: result.mode });
  } catch (e) {
    error(e.message);
  } finally {
    $('expand').disabled = false;
  }
};
function host(context) {
  if (context.theme) {
    applyDocumentTheme(context.theme);
    send({ type: 'theme', value: context.theme });
  }
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  modelContext.host(context);
  // Both host notifications and request responses carry the actual negotiated mode.
  const mode =
    context.displayMode ??
    document.documentElement.dataset.mode ??
    app.getHostContext()?.displayMode;
  document.documentElement.dataset.mode = mode ?? 'inline';
  $('expand').textContent = mode === 'fullscreen' ? 'Свернуть' : 'Развернуть';
  const modes = context.availableDisplayModes ?? app.getHostContext()?.availableDisplayModes ?? [];
  $('expand').hidden = !modes.includes(mode === 'fullscreen' ? 'inline' : 'fullscreen');
}
async function dispose() {
  closed = true;
  candidate?.restoration?.reject(new Error('Представление закрыто.'));
  clearTimeout(loadTimer);
  clearTimeout(candidate?.timer);
  await modelContext.close();
  try {
    if (session) await call('detach');
  } catch {
    /* Host may have closed the channel. */
  }
  await pollingDone;
  frame.srcdoc = '';
  candidate?.frame.remove();
  return {};
}
async function open(result) {
  await dispose();
  session = undefined;
  report = undefined;
  closed = false;
  candidate = undefined;
  failedRevision = undefined;
  modelContext = frameContext(app, extensions);
  $('artifacts').hidden = true;
  error('');
  await mount(result);
}
const library = libraryUI(app, extensions, { session: () => session, error, open });
const voice = voiceUI(app, { session: () => session, error });
const preferences = preferencesUI(app, error);
fileEntrypoint(app, extensions, { open, error });
$('back').onclick = async () => {
  $('back').disabled = true;
  try {
    const result = await app.callServerTool({
      name: 'story_navigate',
      arguments: { sessionId: session.sessionId, back: true },
    });
    if (result.isError) throw new Error(result.content[0].text);
  } catch (e) {
    error(e.message);
  } finally {
    $('back').disabled = false;
  }
};
app.ontoolresult = (result) => {
  if (result.isError) {
    $('connection').textContent = 'Не удалось открыть';
    error(result.content?.find((c) => c.type === 'text')?.text ?? 'Не удалось открыть объяснение.');
    return;
  }
  if (result._meta?.preferences) {
    void preferences.open(result.structuredContent);
    return;
  }
  void mount(result).catch((e) => error(e.message));
};
app.onhostcontextchanged = host;
app.onteardown = dispose;
addEventListener('pagehide', () => {
  void dispose();
});
const connectionTimer = setTimeout(() => {
  $('connection').textContent = 'Нет связи с Codex';
  error('Codex не ответил на подключение. Закройте и откройте плагин снова.');
}, 10000);
try {
  await app.connect();
  clearTimeout(connectionTimer);
  if (!session && $('error').hidden) $('connection').textContent = 'Выберите объяснение';
  host(app.getHostContext() ?? {});
} catch (e) {
  clearTimeout(connectionTimer);
  $('connection').textContent = 'Нет связи с Codex';
  error('Не удалось подключиться к Codex: ' + e.message);
}
