import { createServer } from 'node:net';
import { readFile, chmod, rm, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SessionDirectory } from '../session-directory.mjs';
import { readJSON, writeJSON } from './storage.mjs';
import { ProjectStore } from '../projects.mjs';
import { readProjectFile } from '../project-files.mjs';
import { JobRunner } from '../jobs.mjs';
import { ProjectWatch } from '../project-watch.mjs';
import { Preferences } from '../preferences.mjs';
import { environmentStatus } from '../environment.mjs';
import { macosVoice } from '../../tools/voice/macos.mjs';
import { collectCache } from '../cache.mjs';
import { errorData } from '../errors.mjs';
import { runtimeBuild } from './identity.mjs';

const [socketPath, data] = process.argv.slice(2),
  directory = await realpath(dirname(process.argv[1]));
if (!socketPath || !data)
  throw new Error('Runtime requires its private socket and data directory.');
const protocol = 1;
const build = await runtimeBuild(directory);
const example = JSON.parse(await readFile(join(directory, 'example.json'), 'utf8'));
const sessions = new SessionDirectory();
const projects = new ProjectStore(data);
const preferences = new Preferences(data);
await projects.start();
const watched = new ProjectWatch(async (id) => {
  const project = await projects.inspect(id);
  if (
    projects.queues.has(id) ||
    jobs
      .list(id)
      .some(
        (j) =>
          j.sourceRevision === project.sourceRevision && ['queued', 'running'].includes(j.status),
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
    if (result.buildRevision) {
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
    await collectCache(data, {
      limitMB: (await preferences.read()).cacheLimitMB,
      projects: await projects.list(),
      sessions: [...sessions.sessions.values()],
      snapshotLeases: jobs.snapshotLeases(),
    }).catch((error) => console.error('Cache: ' + error.message));
    return result;
  },
  { toolchainRoot: resolve(directory, '../..') },
);
await jobs.start();
await writeJSON(join(data, 'builds', example.revision + '.json'), example);
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
  return jobs.enqueue(
    'build',
    {
      data,
      projectPath: project.path,
      projectId: project.id,
      title: project.title,
      sourceRevision: project.sourceRevision,
    },
    requestId,
  );
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
  async open({ sessionId, projectId, path, example: exampleId }) {
    if (sessionId) {
      const session = await load(sessionId);
      return session.build.projectId
        ? openProject(await projects.inspect(session.build.projectId), { session })
        : decorate(session);
    }
    if (path && basename(path) === 'story.vstory') path = dirname(path);
    if (path || projectId)
      return openProject(path ? await projects.register(path) : await projects.inspect(projectId));
    let prepared = example;
    if (exampleId) {
      const catalog = await readJSON(join(directory, 'catalog.json'));
      if (!Object.hasOwn(catalog, exampleId))
        throw new Error('Unknown example. Use story_help to choose a shipped example.');
      prepared = await readJSON(join(directory, 'examples', exampleId + '.json'));
      if (!prepared)
        throw new Error('This example has no prepared preview. Create a project from it.');
      await writeJSON(join(data, 'builds', prepared.revision + '.json'), prepared);
    }
    const s = sessions.open(prepared);
    await save(s);
    return decorate(s);
  },
  async create({ path, title = 'Новое объяснение', example = 'explorer-svg', requestId }) {
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
        };
      }
      path ??= join(
        (await preferences.read()).projectsDirectory,
        `${title.replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 60)}-${randomUUID().slice(0, 8)}`,
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
      return { ...decorate(session), project, job };
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
  async catalog() {
    return {
      projects: await projects.list(),
      examples: await readJSON(join(directory, 'catalog.json')),
      environment: await environmentStatus(data),
    };
  },
  async preferences({ patch } = {}) {
    return patch ? preferences.update(patch) : preferences.read();
  },
  async voice({ projectId, sourceRevision, requestId, enabled, voice, language }) {
    const defaults = await preferences.read();
    if (enabled === undefined) {
      const status = await macosVoice.doctor();
      const settings = projectId
        ? await readJSON(join(projects.get(projectId).path, 'voice.json'))
        : undefined;
      const selectedLanguage = language ?? settings?.language ?? defaults.language;
      const voices = status.voices.filter((v) => v.language === selectedLanguage);
      return {
        ...status,
        ready: status.ready && voices.length > 0,
        reason:
          status.reason ??
          (voices.length
            ? undefined
            : `На этом Mac нет голоса для ${selectedLanguage}. Выберите другой язык в настройках.`),
        voices,
        settings,
      };
    }
    const previous = await readJSON(join(projects.get(projectId).path, 'voice.json'));
    const settings = {
      enabled,
      provider: 'macos',
      voice: voice ?? previous?.voice ?? defaults.voice,
      language: language ?? previous?.language ?? defaults.language,
    };
    if (enabled) await macosVoice.prepare(settings, {});
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
      if (source.renderer && source.ready) await sessions.request(sessionId, { op: 'park' });
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
  async help({ query, projectId }) {
    let root = resolve(directory, '../..');
    if (projectId) {
      const project = await projects.inspect(projectId);
      const build =
        project.buildRevision &&
        (await readJSON(join(data, 'builds', project.buildRevision + '.json')));
      if (!build?.snapshot)
        throw new Error('Prepare this project before requesting its pinned API.');
      root = join(build.snapshot, 'node_modules/@visual-storytelling/core');
    }
    // The reader belongs to the installed plugin; declarations belong to the pinned project.
    const { describeAPI } = await import(
      pathToFileURL(join(directory, '../../tools/api.mjs')).href
    );
    const api = await describeAPI(root, query);
    if (!api.missing.length) return api;
    const catalog = (await readJSON(join(root, 'examples/catalog.json'))) ?? {};
    const matches = Object.entries(catalog).filter(([id, e]) =>
      [id, e.title, e.summary].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
    if (matches.length)
      return {
        examples: matches
          .slice(0, 12)
          .map(([id, e]) => ({ id, ...e, source: join(root, 'examples', id, e.source) })),
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
  async produce({ projectId, sourceRevision, requestId, options }) {
    const project = await projects.inspect(projectId);
    if (sourceRevision !== project.sourceRevision)
      throw new Error('Source changed. Inspect before producing this revision.');
    return jobs.enqueue(
      'produce',
      { data, projectId, projectPath: project.path, title: project.title, sourceRevision, options },
      requestId,
    );
  },
  async migrate({ projectId, sourceRevision, requestId }) {
    const project = await projects.inspect(projectId);
    if (sourceRevision !== project.sourceRevision)
      throw new Error('Project changed. Inspect its source before migrating.');
    return jobs.enqueue(
      'migrate',
      { data, projectId, projectPath: project.path, sourceRevision },
      requestId,
    );
  },
  async job({ jobId }) {
    return jobs.get(jobId);
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
    return [...sessions.sessions.values()].map((s) => sessions.describe(s));
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
