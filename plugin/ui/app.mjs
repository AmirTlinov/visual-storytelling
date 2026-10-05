import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import manifest from '../../plugin.json' with { type: 'json' };
import { sceneDocument } from './scene-document.mjs';
import { frameContext } from './frame-context.mjs';
import { libraryUI } from './library.mjs';

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
      sessionId: session.sessionId,
      renderer,
      generation: session.generation,
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
    }
  }
  polling = false;
  done();
}
async function mount(result) {
  if (!result.structuredContent?.sessionId || session) return;
  session = result.structuredContent;
  $('connection').textContent = 'Открываю сцену…';
  const attached = await call('attach');
  session = attached.structuredContent;
  library.update(session);
  $('title').textContent = session.title;
  updateJobs(session.jobs ?? []);
  const config = {
    theme: app.getHostContext()?.theme,
    generation: session.generation,
    checkpoint: session.checkpoint,
    stateRevision: session.stateRevision,
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
  preparing = true;
  try {
    const result = await call('candidate');
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
    });
  } finally {
    preparing = false;
  }
}
function failCandidate(message) {
  if (!candidate) return;
  failedRevision = candidate.revision;
  clearTimeout(candidate.timer);
  candidate.frame.remove();
  candidate = null;
  $('update').hidden = true;
  error('Новая версия не готова: ' + message);
}
async function applyUpdate() {
  if (!candidate?.ready || replacing) return;
  replacing = true;
  $('update').disabled = true;
  try {
    const result = await call('replace', { buildRevision: candidate.revision });
    session = result.structuredContent;
    const old = frame;
    frame = candidate.frame;
    old.id = '';
    frame.id = 'scene';
    frame.className = '';
    frame.removeAttribute('aria-hidden');
    frame.removeAttribute('tabindex');
    frame.contentWindow.postMessage(
      {
        channel,
        generation: candidate.generation,
        type: 'activate',
        nextGeneration: session.generation,
        checkpoint: session.checkpoint,
        stateRevision: session.stateRevision,
      },
      '*',
    );
    candidate = null;
    old.remove();
    $('update').hidden = true;
    error('');
  } catch (e) {
    error(e.message);
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
  if (data.report) report = data.report;
  if (data.type === 'ready') {
    $('connection').textContent = 'Готово';
    clearTimeout(loadTimer);
    sync();
    void publishContext();
  }
  if (data.type === 'report') {
    sync();
    void publishContext();
  }
  if (data.type === 'ack') {
    sync({ id: data.id, result: data.result, error: data.error });
    void publishContext();
  }
  if (data.type === 'error' || data.type === 'expired') {
    error(data.message);
    $('connection').textContent = 'Сцена остановлена';
  }
  if (candidate?.ready && !report?.state.playing) void applyUpdate();
});
$('expand').onclick = async () => {
  try {
    await app.requestDisplayMode({
      mode: app.getHostContext()?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen',
    });
  } catch (e) {
    error(e.message);
  }
};
function host(context) {
  if (context.theme) {
    applyDocumentTheme(context.theme);
    send({ type: 'theme', value: context.theme });
  }
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  modelContext.host(context);
  const mode = context.displayMode ?? app.getHostContext()?.displayMode;
  document.documentElement.dataset.mode = mode ?? 'inline';
  $('expand').textContent = mode === 'fullscreen' ? 'Свернуть' : 'Развернуть';
  const modes = context.availableDisplayModes ?? app.getHostContext()?.availableDisplayModes ?? [];
  $('expand').hidden = !modes.includes('fullscreen');
}
async function dispose() {
  closed = true;
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
const library = libraryUI(app, extensions, {
  session: () => session,
  error,
  open: async (result) => {
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
  },
});
app.ontoolresult = (result) => {
  void mount(result).catch((e) => error(e.message));
};
app.onhostcontextchanged = host;
app.onteardown = dispose;
addEventListener('pagehide', () => {
  void dispose();
});
try {
  await app.connect();
  host(app.getHostContext() ?? {});
} catch (e) {
  error('Не удалось подключиться к Codex: ' + e.message);
}
