import { createServer } from 'node:net';
import { readFile, chmod, rm, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { SessionDirectory } from '../session-directory.mjs';
import { readJSON, writeJSON } from '../../tools/storage.mjs';
import { ProjectStore } from '../projects.mjs';
import { readProjectFile } from '../project-files.mjs';
import { JobRunner } from '../jobs.mjs';
import { ProjectWatch } from '../project-watch.mjs';
import { Preferences } from '../preferences.mjs';
import { environmentStatus, configureEnvironment } from '../../tools/environment.mjs';
import { macosVoice } from '../../tools/voice/macos.mjs';
import { higgsVoice } from '../../tools/voice/higgs.mjs';
import { collectCache } from '../cache.mjs';
import { errorData } from '../errors.mjs';
import { runtimeBuild } from './identity.mjs';
import { revisionInput } from '../revision-input.mjs';
import { selectExamples } from '../../tools/catalog-query.mjs';
import { exampleDetails } from '../../tools/catalog.mjs';
import { readPinnedRuntime } from '../../tools/runtime-package.mjs';
import { videoDimensions } from '../../tools/video-dimensions.mjs';

const [socketPath, data] = process.argv.slice(2),
  directory = await realpath(dirname(process.argv[1]));
if (!socketPath || !data)
  throw new Error('Runtime requires its private socket and data directory.');
const protocol = 1;
const build = await runtimeBuild(directory);
const sessions = new SessionDirectory();
const projects = new ProjectStore(data);
const preferences = new Preferences(data);
await configureEnvironment(data);
await projects.start();
const watched = new ProjectWatch(async (id) => {
  const project = await projects.inspect(id);
  if (
    projects.queues.has(id) ||
    jobs
      .list(id)
      .some(
        (j) =>
          ['build', 'create'].includes(j.kind) &&
          j.sourceRevision === project.sourceRevision &&
          ['queued', 'running'].includes(j.status),
      )
  )
    return;
  const displayed = [...sessions.sessions.values()].filter((s) => s.build.projectId === id);
  if (
    displayed.length &&
    displayed.some(
      (s) =>
        s.build.sourceRevision !== project.sourceRevision &&
        s.nextBuild?.sourceRevision !== project.sourceRevision,
    )
  )
    await prepareProject(project);
});
const jobs = new JobRunner(
  data,
  join(directory, 'worker.mjs'),
  async (job, result) => {
    if (result.migration) {
      const project = await projects.edit({
        projectId: job.projectId,
        sourceRevision: job.sourceRevision,
        requestId: job.id + '-migration',
        ...result.migration,
      });
      return { project, job: await prepareProject(project, job.id + '-build') };
    }
    if (['build', 'create'].includes(job.kind) && result.buildRevision) {
      const current = await projects.inspect(job.projectId);
      if (result.sourceRevision !== current.sourceRevision) return { ...result, superseded: true };
      const prepared = await readJSON(join(data, 'builds', result.buildRevision + '.json'));
      await projects.remember({
        ...projects.get(job.projectId),
        buildRevision: result.buildRevision,
      });
      watched.open(projects.get(job.projectId));
      for (const session of sessions.sessions.values())
        if (session.build.projectId === job.projectId) {
          session.nextBuild = prepared;
          session.wake?.();
        }
    }
    setTimeout(scheduleClose, 0);
    await jobs
      .preserveInputs(async () =>
        collectCache(data, {
          limitMB: (await preferences.read()).cacheLimitMB,
          projects: await projects.list(),
          sessions: [...sessions.sessions.values()],
          snapshotLeases: jobs.snapshotLeases(),
        }),
      )
      .catch((error) => console.error('Cache: ' + error.message));
    return result;
  },
  { toolchainRoot: resolve(directory, '../..') },
);
await jobs.start();
const connections = new Set(),
  saves = new Map(),
  loads = new Map(),
  active = new Set();
let closing = false,
  shutdown,
  idleTimer,
  socketIdentity;
let playbackClaim = Promise.resolve();

function load(id) {
  if (closing) return Promise.reject(new Error('Runtime shutting down.'));
  if (sessions.sessions.has(id)) return Promise.resolve(sessions.get(id));
  if (!/^[a-f0-9-]{36}$/.test(id)) return Promise.reject(new Error('Invalid session ID.'));
  if (loads.has(id)) return loads.get(id);
  const loading = (async () => {
    const saved = await readJSON(join(data, 'sessions', id + '.json'));
    if (!saved) throw new Error('Session is unavailable. Open the project again.');
    if (
      saved.id !== id ||
      !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(saved.buildRevision) ||
      !Number.isSafeInteger(saved.stateRevision) ||
      saved.stateRevision < 0 ||
      !Number.isSafeInteger(saved.generation) ||
      saved.generation < 0
    )
      throw new Error('The saved session is invalid.');
    const source = await readJSON(join(data, 'builds', saved.buildRevision + '.json'));
    if (!source || source.revision !== saved.buildRevision)
      throw new Error('The saved build is unavailable. Rebuild the project.');
    if (closing) throw new Error('Runtime shutting down.');
    const session = sessions.open(source);
    sessions.sessions.delete(session.id);
    Object.assign(session, {
      id,
      checkpoint: saved.checkpoint,
      generation: saved.generation,
      stateRevision: saved.stateRevision,
      observedAt: saved.observedAt,
      returnTo: saved.returnTo ?? [],
      widgetState: saved.widgetState ?? {},
    });
    sessions.sessions.set(id, session);
    return session;
  })();
  loads.set(id, loading);
  const finished = () => {
    if (loads.get(id) === loading) loads.delete(id);
  };
  loading.then(finished, finished);
  return loading;
}

function save(s) {
  const snapshot = {
    id: s.id,
    buildRevision: s.build.revision,
    checkpoint: s.checkpoint,
    generation: s.generation,
    stateRevision: s.stateRevision,
    observedAt: s.observedAt,
    returnTo: s.returnTo ?? [],
    widgetState: s.widgetState ?? {},
  };
  // A transient disk failure must not prevent every later checkpoint from being saved.
  const next = (saves.get(s.id) ?? Promise.resolve())
    .catch(() => {})
    .then(() => writeJSON(join(data, 'sessions', s.id + '.json'), snapshot));
  saves.set(s.id, next);
  const finished = () => {
    if (saves.get(s.id) === next) saves.delete(s.id);
  };
  next.then(finished, (error) => {
    console.error(error.message);
    finished();
  });
  return next;
}

const decorate = (session) => ({
  ...sessions.describe(session),
  jobs: jobs.list(session.build.projectId).filter((j) => j.projectId === session.build.projectId),
});
async function prepareProject(project, requestId = randomUUID()) {
  return jobs.preserveInputs(async () => {
    const input = await revisionInput(data, projects, {
      kind: 'working',
      projectId: project.id,
      sourceRevision: project.sourceRevision,
    });
    return jobs.enqueue('build', { data, ...input }, requestId);
  });
}

async function queueRevision(kind, { target, requestId, options = {} }) {
  if (kind === 'produce' && options.formats?.includes('mp4')) videoDimensions(options);
  return projects.serial('revision:' + requestId, async () => {
    const previous = jobs.forRequest(requestId);
    if (previous) {
      if (
        previous.kind !== kind ||
        !isDeepStrictEqual(previous.input.target, target) ||
        !isDeepStrictEqual(previous.input.requestOptions, options)
      )
        throw new Error('requestId already belongs to another preparation.');
      return jobs.describe(previous);
    }
    let checkpoint, capturedView;
    if (options.conditions === 'current') {
      if (target.kind !== 'build' || !options.sessionId)
        throw new Error('Current conditions need the shown build and its session.');
      const session = await load(options.sessionId);
      if (session.build.projectId !== target.projectId)
        throw new Error('The view belongs to another project.');
      const captured = await sessions.request(session.id, {
        op: 'capture',
        buildRevision: target.buildRevision,
      });
      checkpoint = captured.result.checkpoint;
      capturedView = captured.result.viewport;
    }
    if (checkpoint && options.formats?.some((format) => !['html', 'png', 'svg'].includes(format)))
      throw new Error(
        'Current conditions can be saved as HTML, PNG or SVG. Choose the authored story for other formats.',
      );
    if (options.formats?.includes('mp4') && !options.video)
      throw new Error('Choose the whole story or an explicit interval for video.');
    return jobs.preserveInputs(async () => {
      const input = await revisionInput(data, projects, target);
      return jobs.enqueue(
        kind,
        {
          data,
          ...input,
          checkpoint,
          requestOptions: options,
          options: capturedView ? { ...capturedView, ...options } : options,
        },
        requestId,
      );
    });
  });
}
async function openProject(project, { prepare = true, session } = {}) {
  watched.open(project);
  const prepared =
    project.buildRevision &&
    (await readJSON(join(data, 'builds', project.buildRevision + '.json')));
  if (!session) {
    session = sessions.open(
      prepared || {
        projectId: project.id,
        title: project.title,
        revision: 'preparing-' + project.id,
        html: '',
      },
    );
    if (project.lastSessionId) {
      const previous = await load(project.lastSessionId).catch(() => null);
      if (previous?.build.projectId === project.id) {
        session.checkpoint = structuredClone(previous.checkpoint);
        session.widgetState = structuredClone(previous.widgetState ?? {});
      }
    }
    // Persist the placeholder as well so interrupted creation can be reopened.
    if (!prepared)
      await writeJSON(join(data, 'builds', session.build.revision + '.json'), session.build);
  }
  if (session.build.projectId !== project.id)
    throw new Error('The saved session belongs to another project.');
  if (
    prepared &&
    prepared.revision !== session.build.revision &&
    prepared.sourceRevision === project.sourceRevision
  )
    session.nextBuild = prepared;
  if (
    prepare &&
    session.build.sourceRevision !== project.sourceRevision &&
    session.nextBuild?.sourceRevision !== project.sourceRevision
  )
    await prepareProject(project);
  await save(session);
  if (project.lastSessionId !== session.id)
    await projects.remember({ ...projects.get(project.id), lastSessionId: session.id });
  return { ...decorate(session), project };
}
const operations = {
  async hello() {
    return { protocol, build, serverInstance: sessions.instance, pid: process.pid };
  },
  async open({ sessionId, projectId, path, example: exampleId } = {}) {
    if (sessionId) {
      const session = await load(sessionId);
      return session.build.projectId
        ? openProject(await projects.inspect(session.build.projectId), { session })
        : decorate(session);
    }
    if (path && basename(path) === 'story.vstory') path = dirname(path);
    if (path || projectId)
      return openProject(path ? await projects.register(path) : await projects.inspect(projectId));
    const catalog = await readJSON(join(directory, 'catalog.json'));
    if (!exampleId)
      return {
        status: 'choose-example',
        examples: selectExamples(catalog, { recommended: true }).map((entry) =>
          exampleDetails(entry, resolve(directory, '../..')),
        ),
        action: 'story_open',
      };
    if (!Object.hasOwn(catalog, exampleId))
      throw new Error('Unknown example. Use story_help to choose a shipped example.');
    const prepared = await readJSON(join(directory, 'examples', exampleId + '.json'));
    if (!prepared)
      throw new Error('This example has no prepared preview. Create a project from it.');
    await writeJSON(join(data, 'builds', prepared.revision + '.json'), prepared);
    const s = sessions.open(prepared);
    await save(s);
    return decorate(s);
  },
  async create({ path, title = 'Новое объяснение', example, requestId }) {
    return projects.serial('create:' + requestId, async () => {
      if (path && !isAbsolute(path)) throw new Error('Choose an absolute project path.');
      const previous = jobs.forRequest(requestId);
      if (previous) {
        if (
          previous.kind !== 'create' ||
          previous.input.title !== title ||
          previous.input.example !== example ||
          (path && previous.input.projectPath !== (await realpath(path)))
        )
          throw new Error('requestId already belongs to another project creation.');
        return {
          ...(await openProject(await projects.inspect(previous.projectId), {
            prepare: false,
            session: await load(previous.input.sessionId),
          })),
          job: jobs.describe(previous),
          authoring: previous.authored ? 'ready' : 'preparing',
        };
      }
      path ??= join(
        (await preferences.read()).projectsDirectory,
        `${title.replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 60)}-${randomUUID().slice(0, 8)}`,
      );
      const catalog = await readJSON(join(directory, 'catalog.json'));
      if (!Object.hasOwn(catalog, example))
        throw new Error(
          'Choose a shipped starting point with story_help before creating a project.',
        );
      const project = await projects.create(path, { title, example });
      const session = sessions.open({
        projectId: project.id,
        title,
        revision: 'preparing-' + project.id,
        html: '',
      });
      await writeJSON(join(data, 'builds', session.build.revision + '.json'), session.build);
      await save(session);
      await projects.remember({ ...projects.get(project.id), lastSessionId: session.id });
      const job = await jobs.enqueue(
        'create',
        {
          data,
          projectPath: project.path,
          projectId: project.id,
          title,
          example,
          sessionId: session.id,
        },
        requestId,
      );
      const prepared = await jobs.wait(job.id, { until: 'authored', timeout: 15000 });
      return {
        ...decorate(session),
        project: prepared.authored ?? project,
        job: prepared,
        authoring: prepared.authored ? 'ready' : 'preparing',
      };
    });
  },
  async project({ projectId, file }) {
    return file ? projects.read(projectId, file) : projects.inspect(projectId);
  },
  async shownSource({ sessionId, file }) {
    const session = await load(sessionId),
      shown = session.build;
    if (!shown.snapshot)
      throw new Error(
        'This view has no editable source snapshot. Create a project from the example first.',
      );
    const working = await projects.inspect(shown.projectId);
    return {
      sessionId,
      projectId: shown.projectId,
      buildRevision: shown.revision,
      shownSourceRevision: shown.sourceRevision,
      workingSourceRevision: working.sourceRevision,
      ...(await readProjectFile(shown.snapshot, file)),
    };
  },
  async catalog({ query = '', group = '', recommended = false } = {}) {
    return {
      projects: await projects.list(),
      examples: Object.fromEntries(
        selectExamples(await readJSON(join(directory, 'catalog.json')), {
          query,
          group,
          recommended,
        }).map(({ id, ...entry }) => [id, entry]),
      ),
      environment: await environmentStatus(data),
    };
  },
  async preferences({ patch } = {}) {
    return patch ? preferences.update(patch) : preferences.read();
  },
  async voice({ projectId, sourceRevision, requestId, enabled, provider, voice, language }) {
    const defaults = await preferences.read();
    const previous = projectId
      ? await readJSON(join(projects.get(projectId).path, 'voice.json'))
      : undefined;
    provider ??= previous?.provider ?? 'higgs';
    if (!['higgs', 'macos'].includes(provider)) throw new Error('Unknown narration provider.');
    const selectedLanguage = language ?? previous?.language ?? defaults.language;
    if (enabled === undefined) {
      await configureEnvironment(data);
      const [higgs, macos] = await Promise.all([higgsVoice.doctor(), macosVoice.doctor()]);
      const environment = await environmentStatus(data);
      const choices = [
        { provider: 'higgs', kind: 'neural', ...higgs },
        { provider: 'macos', kind: 'system', ...macos },
      ].map((status) => {
        const voices = status.voices.filter(
          (v) => v.language.split('-')[0] === selectedLanguage.split('-')[0],
        );
        return {
          ...status,
          ready: status.ready && voices.length > 0,
          reason:
            status.reason ??
            (voices.length
              ? undefined
              : `У провайдера ${status.provider} нет голоса для ${selectedLanguage}.`),
          voices,
        };
      });
      const status = choices.find((choice) => choice.provider === provider);
      return {
        provider,
        ready: status.ready,
        reason: status.reason,
        voices: choices.flatMap((choice) =>
          choice.voices.map((item) => ({
            ...item,
            provider: choice.provider,
            kind: choice.kind,
            ready: choice.ready,
            reason: choice.reason,
          })),
        ),
        settings: previous,
        requirements: environment.higgs.requirements,
      };
    }
    const settings = {
      ...(previous?.provider === provider ? previous : {}),
      enabled,
      provider,
      language: selectedLanguage,
    };
    if (provider === 'macos') {
      settings.voice = voice ?? settings.voice ?? defaults.voice;
      if (enabled) {
        const selected = await macosVoice.prepare(settings, {});
        settings.voice = selected.id;
        settings.rate = selected.rate;
      }
    } else {
      if (voice && voice !== 'higgs')
        throw new Error('Для системного голоса явно выберите provider: "macos".');
      if (enabled && selectedLanguage.split('-')[0] !== 'ru')
        throw new Error('Для Higgs сейчас поддерживается русская речь. Выберите ru-RU.');
    }
    return operations.edit({
      projectId,
      sourceRevision,
      requestId,
      changes: [{ path: 'voice.json', content: JSON.stringify(settings, null, 2) + '\n' }],
    });
  },
  async focus({ sessionId, renderer, generation, report }) {
    const claim = playbackClaim
      .catch(() => {})
      .then(async () => {
        const current = sessions.get(sessionId);
        sessions.validate(current, renderer, generation);
        await sessions.exchange({ sessionId, renderer, generation, report, wait: false });
        if (!report || report.stateRevision !== current.stateRevision)
          throw new Error('Playback intent was superseded by a newer action.');
        await Promise.all(
          [...sessions.sessions.values()]
            .filter(
              (other) =>
                other.id !== sessionId && other.ready && other.renderer && !sessions.expired(other),
            )
            .map((other) => sessions.request(other.id, { op: 'park' })),
        );
        sessions.validate(sessions.get(sessionId), renderer, generation);
        if (report.stateRevision !== current.stateRevision)
          throw new Error('Playback intent was superseded by a newer action.');
        return { granted: true };
      });
    playbackClaim = claim;
    return claim;
  },
  async widget({ sessionId, renderer, generation, widget }) {
    const session = sessions.get(sessionId);
    sessions.validate(session, renderer, generation);
    const state = { ...session.widgetState, [widget.id]: widget.snapshot };
    if (JSON.stringify(state).length > 64000)
      throw new Error(
        'Scene persistence is limited to 64 KB. Store authored content in project files.',
      );
    session.widgetState = state;
    await save(session);
    return { saved: true };
  },
  async navigate({ sessionId, target, back = false }) {
    const source = await load(sessionId);
    if (source.navigation) return source.navigation;
    if (source.navigating) return source.navigating;
    source.navigating = (async () => {
      if (source.renderer && source.ready && !sessions.expired(source))
        await sessions.request(sessionId, { op: 'park' });
      await save(source);
      let destination;
      if (back) {
        const id = source.returnTo?.at(-1);
        if (!id) throw new Error('No earlier explanation to return to.');
        destination = await operations.open({ sessionId: id });
      } else {
        destination = await operations.open(target ?? {});
        const next = sessions.get(destination.sessionId);
        next.returnTo = [...(source.returnTo ?? []), source.id].slice(-16);
        await save(next);
        destination = decorate(next);
      }
      if (destination.sessionId === sessionId) return destination;
      source.navigation = destination;
      source.wake?.();
      return destination;
    })();
    try {
      return await source.navigating;
    } finally {
      source.navigating = undefined;
    }
  },
  async help({ query, queries, projectId, group, recommended }) {
    let root = resolve(directory, '../..');
    let pinned;
    if (projectId) {
      const project = await projects.inspect(projectId);
      pinned = await readPinnedRuntime(project.path);
      root = pinned.root;
    }
    // The reader belongs to the installed plugin; declarations belong to the pinned project.
    const { describeAPI, describeAPIData } = await import(
      pathToFileURL(join(directory, '../../tools/api.mjs')).href
    );
    const requested = queries ?? [query];
    const api = pinned
      ? describeAPIData(pinned.api, root, ...requested)
      : await describeAPI(root, ...requested);
    if (queries && !query) return api;
    if (!queries && !api.missing.length) return api;
    const catalog = pinned?.catalog ?? (await readJSON(join(directory, 'catalog.json'))) ?? {};
    const matches = selectExamples(catalog, {
      query,
      group,
      recommended,
    });
    if (matches.length || queries)
      return {
        ...(queries ? api : {}),
        examples: matches.slice(0, 12).map((entry) =>
          pinned?.archive
            ? {
                ...entry,
                runtimeArchive: pinned.archive,
                source: `package/examples/${entry.id}/${entry.source}`,
              }
            : exampleDetails(entry, root),
        ),
      };
    return api;
  },
  async edit(args) {
    const project = await projects.edit(args);
    const previous = project.repeated && jobs.forRequest(args.requestId + '-build');
    return {
      project,
      job: previous
        ? jobs.describe(previous)
        : await prepareProject(project, args.requestId + '-build'),
    };
  },
  produce: (args) => queueRevision('produce', args),
  review: (args) => queueRevision('review', args),
  async migrate({ projectId, sourceRevision, requestId, changes }) {
    const project = await projects.inspect(projectId);
    if (sourceRevision !== project.sourceRevision)
      throw new Error('Project changed. Inspect its source before migrating.');
    return jobs.enqueue(
      'migrate',
      { data, projectId, projectPath: project.path, sourceRevision, changes },
      requestId,
    );
  },
  async job({ jobId, waitMs = 0 }) {
    return jobs.wait(jobId, { timeout: waitMs });
  },
  async cancel({ jobId }) {
    return jobs.cancel(jobId);
  },
  async retry({ jobId, requestId }) {
    return jobs.retry(jobId, requestId);
  },
  async candidate({ sessionId, renderer, generation }) {
    const session = sessions.get(sessionId);
    sessions.validate(session, renderer, generation);
    if (!session.nextBuild) throw new Error('No prepared update.');
    return {
      ...session.nextBuild,
      checkpoint: session.checkpoint,
      stateRevision: session.stateRevision,
      widgetState: session.widgetState ?? {},
    };
  },
  async replace(args) {
    const result = await sessions.replace(args);
    await save(sessions.get(args.sessionId));
    return result;
  },
  async request({ sessionId, request }) {
    await load(sessionId);
    return sessions.request(sessionId, request);
  },
  async attach({ sessionId, renderer }) {
    const s = await load(sessionId);
    const attached = await sessions.attach(sessionId, renderer);
    await save(s);
    return {
      ...attached,
      widgetState: s.widgetState ?? {},
      jobs: jobs.list(s.build.projectId).filter((j) => j.projectId === s.build.projectId),
    };
  },
  async recover(args) {
    const s = await load(args.sessionId);
    const result = await sessions.recover(args);
    await save(s);
    return {
      ...result,
      widgetState: s.widgetState ?? {},
      jobs: jobs.list(s.build.projectId).filter((j) => j.projectId === s.build.projectId),
    };
  },
  async exchange(params) {
    const { state: _state, ...result } = await sessions.exchange(params);
    if (params.report) await save(sessions.get(params.sessionId));
    return {
      ...result,
      navigation: sessions.get(params.sessionId).navigation,
      jobs: jobs
        .list(sessions.get(params.sessionId).build.projectId)
        .filter((j) => j.projectId === sessions.get(params.sessionId).build.projectId),
    };
  },
  async detach(params) {
    const detached = sessions.detach(params);
    if (detached) delete sessions.get(params.sessionId).navigation;
    return { detached };
  },
  async list() {
    return [...sessions.sessions.values()].map(decorate);
  },
};

function scheduleClose() {
  clearTimeout(idleTimer);
  if (!connections.size && !closing)
    idleTimer = setTimeout(() => {
      if (jobs.busy) scheduleClose();
      else void close();
    }, 1500);
}

const server = createServer((socket) => {
  if (closing) {
    socket.destroy();
    return;
  }
  clearTimeout(idleTimer);
  connections.add(socket);
  socket.setEncoding('utf8');
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 32_000_000) {
      socket.destroy();
      return;
    }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      const operation = (async () => {
        let id;
        try {
          if (closing) throw new Error('Runtime shutting down.');
          const request = JSON.parse(line);
          id = request.id;
          if (!Object.hasOwn(operations, request.method))
            throw new Error('Unknown runtime operation.');
          const result = await operations[request.method](request.params);
          if (!socket.destroyed) socket.write(JSON.stringify({ id, result }) + '\n');
        } catch (error) {
          if (!socket.destroyed)
            socket.write(JSON.stringify({ id, error: errorData(error) }) + '\n');
        }
      })();
      active.add(operation);
      const finished = () => active.delete(operation);
      operation.then(finished, finished);
    }
  });
  socket.on('error', () => {});
  socket.on('close', () => {
    connections.delete(socket);
    scheduleClose();
  });
});

function close() {
  if (shutdown) return shutdown;
  closing = true;
  clearTimeout(idleTimer);
  const stopped = new Promise((resolve) => server.close(resolve));
  sessions.close();
  watched.close();
  shutdown = (async () => {
    await Promise.allSettled([...active]);
    await jobs.close();
    await Promise.allSettled([...saves.values()]);
    await stopped;
    const current = await lstat(socketPath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (current && current.dev === socketIdentity.dev && current.ino === socketIdentity.ino)
      await rm(socketPath, { force: true });
  })().catch((error) => console.error(error.message));
  return shutdown;
}

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(socketPath, resolve);
});
socketIdentity = await lstat(socketPath);
await chmod(socketPath, 0o600);
scheduleClose();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    for (const socket of connections) socket.destroy();
    void close();
  });
