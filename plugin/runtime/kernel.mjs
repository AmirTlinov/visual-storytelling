import { createServer } from 'node:net';
import { readFile, chmod, rm, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve, isAbsolute, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { SessionDirectory } from '../session-directory.mjs';
import { readJSON, writeJSON } from './storage.mjs';
import { ProjectStore } from '../projects.mjs';
import { JobRunner } from '../jobs.mjs';
import { ProjectWatch } from '../project-watch.mjs';

const [socketPath, data] = process.argv.slice(2),
  directory = dirname(process.argv[1]);
if (!socketPath || !data)
  throw new Error('Runtime requires its private socket and data directory.');
const protocol = 1;
const build = createHash('sha256')
  .update(await readFile(process.argv[1]))
  .digest('hex');
const example = JSON.parse(await readFile(join(directory, 'example.json'), 'utf8'));
const sessions = new SessionDirectory();
const projects = new ProjectStore(data);
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
const jobs = new JobRunner(data, join(directory, 'worker.mjs'), async (job, result) => {
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
  return result;
});
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
async function openProject(project, { prepare = true } = {}) {
  watched.open(project);
  let session = [...sessions.sessions.values()].find((s) => s.build.projectId === project.id);
  if (!session && project.lastSessionId) session = await load(project.lastSessionId);
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
    const s = sessionId ? await load(sessionId) : sessions.open(prepared);
    if (s.build.projectId) return openProject(await projects.inspect(s.build.projectId));
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
          ...(await openProject(await projects.inspect(previous.projectId), { prepare: false })),
          job: jobs.describe(previous),
        };
      }
      path ??= join(
        data,
        'projects',
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
        { data, projectPath: project.path, projectId: project.id, title, example },
        requestId,
      );
      return { ...decorate(session), project, job };
    });
  },
  async project({ projectId, file }) {
    return file ? projects.read(projectId, file) : projects.inspect(projectId);
  },
  async catalog() {
    return {
      projects: await projects.list(),
      examples: await readJSON(join(directory, 'catalog.json')),
    };
  },
  async help({ query }) {
    const root = resolve(directory, '../..');
    const catalog = JSON.parse(await readFile(join(root, 'examples/catalog.json'), 'utf8'));
    const matches = Object.entries(catalog).filter(([id, e]) =>
      [id, e.title, e.summary].join(' ').toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
    if (matches.length)
      return {
        examples: matches
          .slice(0, 12)
          .map(([id, e]) => ({ id, ...e, source: join(root, 'examples', id, e.source) })),
      };
    const { describeAPI } = await import(pathToFileURL(join(root, 'tools/api.mjs')).href);
    return describeAPI(root, query);
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
  async job({ jobId }) {
    return jobs.get(jobId);
  },
  async cancel({ jobId }) {
    return jobs.cancel(jobId);
  },
  async candidate({ sessionId, renderer, generation }) {
    const session = sessions.get(sessionId);
    sessions.validate(session, renderer, generation);
    if (!session.nextBuild) throw new Error('No prepared update.');
    return {
      ...session.nextBuild,
      checkpoint: session.checkpoint,
      stateRevision: session.stateRevision,
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
      jobs: jobs.list(s.build.projectId).filter((j) => j.projectId === s.build.projectId),
    };
  },
  async exchange(params) {
    const result = await sessions.exchange(params);
    if (params.report) await save(sessions.get(params.sessionId));
    return {
      ...result,
      jobs: jobs
        .list(sessions.get(params.sessionId).build.projectId)
        .filter((j) => j.projectId === sessions.get(params.sessionId).build.projectId),
    };
  },
  async detach(params) {
    sessions.detach(params);
    return { detached: true };
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
          if (!socket.destroyed) socket.write(JSON.stringify({ id, error: error.message }) + '\n');
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
