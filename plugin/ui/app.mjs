import { App, applyDocumentTheme, applyHostStyleVariables } from '@modelcontextprotocol/ext-apps';
import { OpenAIExtensions } from '@openai/mcp-extensions/app';
import manifest from '../../plugin.json' with { type: 'json' };
import { sceneDocument } from './scene-document.mjs';
import { frameContext } from './frame-context.mjs';
import { preferencesUI } from './preferences.mjs';
import { fileEntrypoint } from './file-entrypoint.mjs';
import preparedLiveHTML from 'visual-story:prepared-live-scene';
import { prepareIllustratedDocument } from '../../src/story/document.ts';

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
let provisional;
// Time when this app module starts executing; this excludes host resource fetch time.
const resourceMountedAt = performance.now();
let creationMetrics = { timeOrigin: performance.timeOrigin, resourceMountedAt };
window.__visualStoryCreationMetrics = creationMetrics;
function observeContent(renderStatus, confirmed = false) {
  if (!['prepared', 'rendered'].includes(renderStatus)) return;
  const now = performance.now();
  creationMetrics.firstPreparedAt ??= now;
  if (confirmed) creationMetrics.confirmedPreparedAt ??= now;
  // The scene's rendered acknowledgement reports frame opportunities, not pixels.
  if (renderStatus === 'rendered') {
    creationMetrics.firstContentAt ??= now;
    if (confirmed) creationMetrics.confirmedAt ??= now;
  }
}
function discardProvisional() {
  if (!provisional) return;
  provisional = undefined;
  frame.srcdoc = '';
  frame.hidden = true;
  delete frame.dataset.provisional;
  $('notice').hidden = true;
}
function previewInput({ arguments: args } = {}) {
  if (args?.context) {
    if (!session) discardProvisional();
    return;
  }
  if (session || !args?.document) return;
  creationMetrics.inputAt ??= performance.now();
  let document;
  try {
    document = prepareIllustratedDocument(args.document).document;
  } catch {
    return;
  } // An incomplete operation leaves the last coherent preview visible.
  const identity = JSON.stringify(document);
  if (provisional?.identity === identity) return;
  if (!provisional) {
    provisional = { id: crypto.randomUUID(), generation: -1, identity, document, ready: false };
    const setup = `<script>window.__visualStoryDocument=${identity.replaceAll('<', '\\u003c')}</script>`;
    frame.hidden = false;
    $('catalog').hidden = true;
    frame.dataset.provisional = 'true';
    $('notice').textContent = 'Предварительный показ';
    $('notice').hidden = false;
    frame.srcdoc = sceneDocument(
      preparedLiveHTML.replace('</head>', () => setup + '</head>'),
      {
        sessionId: provisional.id,
        generation: provisional.generation,
        preview: true,
        provisional: true,
        stateRevision: 0,
        theme: app.getHostContext()?.theme,
      },
    );
  } else {
    provisional.document = document;
    provisional.identity = identity;
    if (provisional.ready) sendPreview('author-preview', { document });
  }
}
function sendPreview(type, values) {
  frame.contentWindow?.postMessage(
    {
      channel,
      sessionId: provisional.id,
      generation: provisional.generation,
      type,
      ...values,
    },
    '*',
  );
}
let pollingDone = Promise.resolve();
let updates = Promise.resolve();
let displayMode = 'inline';
let connectionState = 'opening',
  recovery,
  recoveryEpoch = 0,
  recoveryAck;
function setConnectionState(value) {
  connectionState = value;
  document.documentElement.dataset.connection = value;
}
setConnectionState(connectionState);
function sync(acknowledgement) {
  const current = report,
    owner = session;
  updates = updates
    .then(async () => {
      if (closed || session !== owner) return;
      const exchanged = await call('exchange', {
        report: current,
        acknowledgements: acknowledgement ? [acknowledgement] : [],
        wait: false,
      });
      if (session === owner && exchanged.structuredContent.generation === owner.generation) {
        for (const key of [
          'buildRevision',
          'sourceRevision',
          'shownSourceRevision',
          'stateRevision',
          'context',
        ])
          owner[key] = exchanged.structuredContent[key];
        publishContext();
      }
    })
    .catch((e) => {
      if (!closed && session === owner) error(connectionErrorMessage(e));
    });
}
function connectionErrorMessage(failure) {
  return failure?.code === 'RUNTIME_UPDATE_REQUIRED'
    ? 'Установлена новая версия. Переподключите Visual Storytelling в настройках плагинов Codex.'
    : (failure?.message ?? 'Связь пока недоступна.');
}
function error(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}
const send = (value) =>
  frame.contentWindow?.postMessage(
    { channel, sessionId: session?.sessionId, generation: session?.generation, ...value },
    '*',
  );
async function call(action, args = {}) {
  const metrics = creationMetrics;
  if (action === 'attach') metrics.attachStartedAt ??= performance.now();
  if (args.report) metrics.firstReportStartedAt ??= performance.now();
  const result = await app.callServerTool({
    name: 'story_view',
    arguments: {
      action,
      sessionId: session?.sessionId,
      renderer,
      generation: session?.generation,
      ...args,
      ...(args.report && { report: { ...args.report, metrics: { ...metrics } } }),
    },
  });
  if (action === 'attach') metrics.attachCompletedAt ??= performance.now();
  if (result.isError)
    throw Object.assign(
      new Error(result.content?.find((c) => c.type === 'text')?.text ?? 'Connection failed'),
      result.structuredContent?.error,
    );
  return result;
}
function beforeDeadline(promise, deadline) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Связь пока недоступна. Попробуйте восстановить её.')),
      Math.max(0, deadline - Date.now()),
    );
    Promise.resolve(promise)
      .then(resolve, reject)
      .finally(() => clearTimeout(timer));
  });
}
function recoverView(cause) {
  if (recovery) return recovery;
  const owner = session?.sessionId,
    epoch = ++recoveryEpoch;
  if (!owner || closed) return Promise.resolve(false);
  setConnectionState('recovering');
  $('reconnect').hidden = true;
  send({
    type: 'command',
    command: { op: 'suspend', id: crypto.randomUUID(), expiresAt: Date.now() + 1000 },
  });
  const deadline = Date.now() + 15000;
  recovery = (async () => {
    let failure = cause,
      delay = 250;
    while (!closed && epoch === recoveryEpoch && session?.sessionId === owner) {
      if (
        [
          'view_replaced',
          'RUNTIME_VERSION_CONFLICT',
          'RUNTIME_UPDATE_REQUIRED',
          'installation_missing',
        ].includes(failure?.code)
      )
        break;
      try {
        const result = await beforeDeadline(
          call('recover', {
            serverInstance: session.serverInstance,
            report,
          }),
          deadline,
        );
        if (closed || epoch !== recoveryEpoch || session?.sessionId !== owner) return false;
        session = result.structuredContent;
        const id = crypto.randomUUID();
        const restored = new Promise((resolve, reject) => {
          recoveryAck = { id: result._meta?.sceneHTML ? undefined : id, resolve, reject };
        });
        if (result._meta?.sceneHTML) {
          frame.srcdoc = sceneDocument(result._meta.sceneHTML, {
            theme: app.getHostContext()?.theme,
            sessionId: session.sessionId,
            generation: session.generation,
            checkpoint: session.checkpoint,
            stateRevision: session.stateRevision,
            widgetState: session.widgetState,
            authoredInputs: session.authoredInputs,
          });
        } else send({ type: 'command', command: { op: 'resume', id, expiresAt: deadline } });
        report = await beforeDeadline(restored, deadline);
        recoveryAck = undefined;
        await beforeDeadline(call('exchange', { report, wait: false }), deadline);
        if (closed || epoch !== recoveryEpoch) return false;
        setConnectionState('connected');
        error('');
        publishContext();
        return true;
      } catch (e) {
        recoveryAck = undefined;
        failure = e;
        if (Date.now() + delay >= deadline) break;
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay = Math.min(delay * 2, 2000);
      }
    }
    if (!closed && epoch === recoveryEpoch) {
      setConnectionState('unavailable');
      const updateRequired = failure?.code === 'RUNTIME_UPDATE_REQUIRED';
      error(connectionErrorMessage(failure));
      $('reconnect').textContent =
        failure?.code === 'view_replaced' ? 'Открыть здесь' : 'Восстановить связь';
      $('reconnect').dataset.takeover = String(failure?.code === 'view_replaced');
      $('reconnect').hidden = updateRequired;
    }
    return false;
  })().finally(() => {
    recovery = undefined;
  });
  return recovery;
}
async function ensureConnected() {
  if (connectionState === 'connected') return;
  if (!(await recoverView())) throw new Error('Сначала восстановите связь со сценой.');
  void poll();
}
$('reconnect').onclick = async () => {
  $('reconnect').disabled = true;
  try {
    if ($('reconnect').dataset.takeover === 'true') {
      const result = await app.callServerTool({
        name: 'story_open',
        arguments: { sessionId: session.sessionId },
      });
      if (result.isError) throw new Error(result.content[0].text);
      await open(result);
    } else if (await recoverView()) void poll();
  } catch (e) {
    error(e.message);
  } finally {
    $('reconnect').disabled = false;
  }
};
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
      if (!(await recoverView(e))) break;
    }
  }
  polling = false;
  done();
}
async function mount(result) {
  if (session) return;
  if (result.structuredContent?.status === 'choose-example') {
    frame.hidden = true;
    $('catalog').hidden = false;
    const list = $('catalog-examples');
    list.replaceChildren();
    let opening = false;
    for (const example of result.structuredContent.examples) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      const title = document.createElement('strong');
      const description = document.createElement('span');
      button.type = 'button';
      title.textContent = example.title;
      description.textContent = example.summary;
      button.append(title, description);
      button.onclick = async () => {
        if (opening) return;
        opening = true;
        for (const choice of list.querySelectorAll('button')) choice.disabled = true;
        try {
          const selected = await app.callServerTool({
            name: 'story_open',
            arguments: { example: example.id },
          });
          if (selected.isError) throw new Error(selected.content[0].text);
          if (!closed) await mount(selected);
        } catch (e) {
          error(e.message);
        } finally {
          opening = false;
          for (const choice of list.querySelectorAll('button')) choice.disabled = false;
        }
      };
      item.append(button);
      list.append(item);
    }
    return;
  }
  if (!result.structuredContent?.sessionId) return;
  creationMetrics.toolResultAt ??= performance.now();
  $('catalog').hidden = true;
  frame.hidden = false;
  error('');
  session = result.structuredContent;
  setConnectionState('opening');
  const attached = await call('attach');
  session = attached.structuredContent;
  $('back').hidden = !session.returnAvailable;
  document.title = session.title;
  updateJobs(session.jobs ?? []);
  const config = {
    theme: app.getHostContext()?.theme,
    sessionId: session.sessionId,
    generation: session.generation,
    checkpoint: session.checkpoint,
    stateRevision: session.stateRevision,
    widgetState: session.widgetState,
    authoring: session.authoring,
    authoredInputs: session.authoredInputs,
  };
  if (attached._meta.sceneHTML) {
    if (provisional && session.authoredDocument) {
      provisional.confirmation = {
        document: session.authoredDocument,
        nextSessionId: session.sessionId,
        nextGeneration: session.generation,
        stateRevision: session.stateRevision,
        checkpoint: session.checkpoint,
        authoring: session.authoring,
      };
      if (provisional.ready) sendPreview('confirm-preview', provisional.confirmation);
    } else {
      provisional = undefined;
      delete frame.dataset.provisional;
      frame.srcdoc = sceneDocument(attached._meta.sceneHTML, config);
    }
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
      sessionId: session.sessionId,
      preview: true,
      generation: candidate.generation,
      checkpoint: next.checkpoint,
      authoredInputs: next.authoredInputs,
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
          sessionId: owner.sessionId,
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
        sessionId: owner.sessionId,
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
    $('cancel').onclick = async () => {
      try {
        const result = await app.callServerTool({
          name: 'story_cancel',
          arguments: { jobId: active.id },
        });
        if (result.isError) throw new Error(result.content[0].text);
      } catch (e) {
        error(e.message);
      }
    };
  }
  const last = jobs.find((job) => !job.supersededBy);
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
}
$('update').onclick = () => void applyUpdate();
addEventListener('message', (event) => {
  const data = event.data;
  if (
    provisional &&
    event.source === frame.contentWindow &&
    data?.channel === channel &&
    data.sessionId === provisional.id &&
    data.generation === provisional.generation
  ) {
    if (data.type === 'ready') {
      provisional.ready = true;
      observeContent(data.report?.renderStatus);
      if (provisional.confirmation) sendPreview('confirm-preview', provisional.confirmation);
      else sendPreview('author-preview', { document: provisional.document });
    }
    if (data.type === 'preview-content') observeContent(data.renderStatus);
    if (data.type === 'error') error(data.message);
    return;
  }
  if (
    event.source === candidate?.frame.contentWindow &&
    data?.channel === channel &&
    data.sessionId === session?.sessionId &&
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
      if (['opening', 'connected'].includes(connectionState) && !report?.state.playing)
        void applyUpdate();
    }
    return;
  }
  if (
    event.source !== frame.contentWindow ||
    data?.channel !== channel ||
    data.sessionId !== session?.sessionId ||
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
  if (data.report) {
    report = data.report;
    observeContent(data.report.renderStatus, true);
  }
  if (
    recoveryAck &&
    ((data.type === 'ready' && recoveryAck.id === undefined) ||
      (data.type === 'ack' && data.id === recoveryAck.id))
  ) {
    data.error ? recoveryAck.reject(new Error(data.error)) : recoveryAck.resolve(data.report);
    return;
  }
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
    if (provisional) {
      provisional = undefined;
      delete frame.dataset.provisional;
    }
    setConnectionState('connected');
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
    if (data.type === 'expired')
      void recoverView(new Error(data.message)).then((ok) => {
        if (ok) void poll();
      });
  }
  if (
    ['opening', 'connected'].includes(connectionState) &&
    candidate?.ready &&
    !report?.state.playing
  )
    void applyUpdate();
});
function host(context) {
  if (context.theme) {
    applyDocumentTheme(context.theme);
    send({ type: 'theme', value: context.theme });
  }
  if (context.styles?.variables) applyHostStyleVariables(context.styles.variables);
  modelContext.host(context);
  displayMode = context.displayMode ?? displayMode;
  document.documentElement.dataset.mode = displayMode;
}
async function dispose() {
  closed = true;
  setConnectionState('closed');
  recoveryEpoch++;
  recoveryAck?.reject(new Error('Представление закрыто.'));
  recoveryAck = undefined;
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
  creationMetrics = { timeOrigin: performance.timeOrigin, resourceMountedAt };
  window.__visualStoryCreationMetrics = creationMetrics;
  $('update').hidden = true;
  $('back').hidden = true;
  error('');
  await mount(result);
}
const preferences = preferencesUI(app, error);
fileEntrypoint(app, extensions, { open, error });
$('back').onclick = async () => {
  $('back').disabled = true;
  try {
    await ensureConnected();
    const result = await app.callServerTool({
      name: 'story_navigate',
      arguments: { context: session.context, back: true },
    });
    if (result.isError) throw new Error(result.content[0].text);
  } catch (e) {
    error(e.message);
  } finally {
    $('back').disabled = false;
  }
};
app.ontoolresult = (result) => {
  if (result.structuredContent?.presentation?.kind === 'existing-card') {
    // Navigation belongs to the mounted card. A host may create a redundant resource
    // from the tool's static UI metadata; it must never attach the destination too.
    if (!session) {
      discardProvisional();
      void app.requestTeardown().catch((e) => error(e.message));
    }
    return;
  }
  if (result.isError) {
    error(result.content?.find((c) => c.type === 'text')?.text ?? 'Не удалось открыть объяснение.');
    return;
  }
  if (result._meta?.preferences) {
    void preferences.open(result.structuredContent);
    return;
  }
  void mount(result).catch((e) => error(e.message));
};
app.ontoolinputpartial = previewInput;
app.ontoolinput = previewInput;
app.onhostcontextchanged = host;
app.onteardown = dispose;
addEventListener('pagehide', () => {
  void dispose();
});
const connectionTimer = setTimeout(() => {
  error('Codex не ответил на подключение. Закройте и откройте плагин снова.');
}, 10000);
try {
  await app.connect();
  clearTimeout(connectionTimer);
  host(app.getHostContext() ?? {});
} catch (e) {
  clearTimeout(connectionTimer);
  error('Не удалось подключиться к Codex: ' + e.message);
}
