import { chmod, rm, lstat, realpath } from 'node:fs/promises';
import { dirname, join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { SessionDirectory, buildReference } from '../session-directory.mjs';
import { readJSON, writeJSON } from '../../tools/storage.mjs';
import { ProjectStore } from '../projects.mjs';
import { readProjectFile } from '../../tools/project-files.mjs';
import { JobRunner } from '../jobs.mjs';
import { ProjectWatch } from '../project-watch.mjs';
import { Preferences } from '../preferences.mjs';
import { projectVoice } from '../voice.mjs';
import { environmentStatus, configureEnvironment } from '../../tools/environment.mjs';
import { runtimeCache } from './cache-maintenance.mjs';
import { sessionStorage } from './session-storage.mjs';
import { runtimeSocketServer } from './socket-server.mjs';
import { projectAuthoring } from './project-authoring.mjs';
import { errorData, failure } from '../errors.mjs';
import { runtimeBuild, installedRuntime, requireSelectedRuntime } from './identity.mjs';
import { acquireDirectoryLock } from '../../tools/file-lock.mjs';
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
await requireSelectedRuntime(directory);
// Startup and retirement can overlap at the socket, never at persisted session/job ownership.
const unlockOwner = await acquireDirectoryLock(socketPath + '.owner');
try {
  await requireSelectedRuntime(directory);
} catch (error) {
  await unlockOwner();
  throw error;
}
const build = await runtimeBuild(directory);
const sessions = new SessionDirectory();
const projects = new ProjectStore(data);
const preferences = new Preferences(data);
await configureEnvironment(data);
await projects.start();
const watched = new ProjectWatch(async (id) => {
  const project = await projects.inspect(id);
  if (
    updating ||
    projects.queues.has(id) ||
    projects.queues.has('delivery:' + id) ||
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
    if (job.input.authoring || result.migration || result.creation) {
      const response = result.creation
        ? await authoring.acceptCreationJob(job, result)
        : result.migration
          ? await authoring.acceptMigration(job, result)
          : await authoring.acceptCandidate(job, result);
      setTimeout(scheduleClose, 0);
      scheduleCache();
      return response;
    }
    if (['build', 'create'].includes(job.kind) && result.buildRevision) {
      const current = await projects.inspect(job.projectId);
      if (result.sourceRevision !== current.sourceRevision) return { ...result, superseded: true };
      const prepared = await readJSON(join(data, 'builds', result.buildRevision + '.json'));
      await authoring.publishBuild(current, prepared);
    }
    setTimeout(scheduleClose, 0);
    scheduleCache();
    return result;
  },
  { toolchainRoot: resolve(directory, '../..') },
);
await jobs.start();
const work = new Set();
let closing = false,
  updating = false,
  shutdown,
  idleTimer,
  socketIdentity;
let playbackClaim = Promise.resolve();
const cache = runtimeCache({ data, preferences, projects, sessions, jobs });
const scheduleCache = () => cache.schedule();

const {
  load,
  save,
  viewBuild,
  drain: drainSessionWrites,
} = sessionStorage(data, sessions, () => closing);

const decorate = (session) => ({
  ...sessions.describe(session),
  jobs: jobs.list(session.build.projectId).filter((j) => j.projectId === session.build.projectId),
});
async function prepareProject(project, requestId = randomUUID()) {
  const preparation = jobs.preserveInputs(async () => {
    const input = await revisionInput(data, projects, {
      kind: 'working',
      projectId: project.id,
      sourceRevision: project.sourceRevision,
    });
    return jobs.enqueue('build', { data, ...input }, requestId);
  });
  work.add(preparation);
  try {
    return await preparation;
  } finally {
    work.delete(preparation);
    scheduleClose();
  }
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
  await jobs.preserveInputs(async () => {
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
      // Publish the placeholder and its persisted card under the same lease lock.
      if (!prepared)
        await writeJSON(join(data, 'builds', session.build.revision + '.json'), {
          ...session.build,
          html: '',
        });
    }
    if (session.build.projectId !== project.id)
      throw new Error('The saved session belongs to another project.');
    if (
      prepared &&
      prepared.revision !== session.build.revision &&
      prepared.sourceRevision === project.sourceRevision
    )
      session.nextBuild = buildReference(prepared);
    await save(session);
    if (project.lastSessionId !== session.id)
      await projects.update(project.id, { lastSessionId: session.id });
  });
  // Preparation captures its own inputs; never acquire that lock recursively.
  if (
    prepare &&
    !jobs
      .list(project.id)
      .some(
        (job) => job.kind === 'create' && ['queued', 'running', 'cancelling'].includes(job.status),
      ) &&
    session.build.sourceRevision !== project.sourceRevision &&
    session.nextBuild?.sourceRevision !== project.sourceRevision
  )
    await prepareProject(project);
  return { ...decorate(session), project };
}
const authoring = projectAuthoring({
  data,
  directory,
  projects,
  jobs,
  sessions,
  preferences,
  watched,
  load,
  save,
  decorate,
  scheduleCache,
  navigate: (args) => operations.navigate(args),
});
const operations = {
  async hello() {
    return {
      protocol,
      build,
      serverInstance: sessions.instance,
      pid: process.pid,
      cache: cache.report,
    };
  },
  async prepareUpdate() {
    const installed = await installedRuntime(directory);
    if (!installed || installed.directory === directory) return { updating: false };
    updating = true;
    watched.close();
    scheduleClose();
    // A terminal job is already observable while its receipt is still being saved.
    // The successor can wait on the existing bounded owner-lock handoff for that drain;
    // only an unfinished preparation requires the caller to retry later.
    return {
      updating: true,
      busy: Boolean(
        jobs.queue.length ||
          (jobs.active && ['queued', 'running', 'cancelling'].includes(jobs.active.job.status)),
      ),
    };
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
    return jobs.preserveInputs(async () => {
      await writeJSON(join(data, 'builds', prepared.revision + '.json'), prepared);
      const s = sessions.open(prepared);
      await save(s);
      return decorate(s);
    });
  },
  create: authoring.create,
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
    const value = patch ? await preferences.update(patch) : await preferences.read();
    if (patch?.cacheLimitMB !== undefined) scheduleCache();
    return value;
  },
  voice: projectVoice({ data, preferences, projects, edit: (args) => operations.edit(args) }),
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
        if (!id) throw new Error('No earlier document to return to.');
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
  edit: authoring.edit,
  produce: (args) => queueRevision('produce', args),
  review: (args) => queueRevision('review', args),
  migrate: authoring.migrate,
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
      ...(await viewBuild(session.nextBuild.revision)),
      checkpoint: session.checkpoint,
      stateRevision: session.stateRevision,
      widgetState: session.widgetState ?? {},
    };
  },
  async replace(args) {
    const result = await sessions.replace(args);
    await save(sessions.get(args.sessionId));
    scheduleCache();
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
      html: (await viewBuild(attached.buildRevision)).html,
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
      ...(result.recovery === 'reload' && { html: (await viewBuild(result.buildRevision)).html }),
      widgetState: s.widgetState ?? {},
      jobs: jobs.list(s.build.projectId).filter((j) => j.projectId === s.build.projectId),
    };
  },
  async exchange(params) {
    const { state: _state, ...result } = await sessions.exchange(params);
    if (params.report) {
      const session = sessions.get(params.sessionId);
      await save(session);
      await authoring.observeCreationDelivery(session);
    }
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
    if (detached) {
      delete sessions.get(params.sessionId).navigation;
      await save(sessions.get(params.sessionId));
      scheduleCache();
    }
    return { detached };
  },
  async list() {
    return [...sessions.sessions.values()].map(decorate);
  },
};

function scheduleClose() {
  clearTimeout(idleTimer);
  if ((updating || !socketServer.connectionCount) && !closing)
    idleTimer = setTimeout(
      () => {
        if (jobs.busy || (updating && (work.size || socketServer.workCount))) scheduleClose();
        else void close();
      },
      updating ? 100 : 1500,
    );
}

const socketServer = runtimeSocketServer({
  operations,
  isClosing: () => closing,
  isUpdating: () => updating,
  onConnect: () => clearTimeout(idleTimer),
  onActivity: scheduleClose,
});

function close() {
  if (shutdown) return shutdown;
  closing = true;
  clearTimeout(idleTimer);
  watched.close();
  let released = false;
  shutdown = (async () => {
    // A long poll may have accepted a report before its response is released.
    await Promise.all([...sessions.sessions.values()].map(save));
    sessions.close();
    await socketServer.drain();
    await jobs.close();
    await drainSessionWrites();
    await socketServer.close();
    released = true;
    const current = await lstat(socketPath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (current && current.dev === socketIdentity.dev && current.ino === socketIdentity.ino)
      await rm(socketPath, { force: true });
  })()
    .catch((error) => {
      console.error(error.message);
      if (!released) {
        closing = false;
        shutdown = undefined;
        scheduleClose();
      }
    })
    .finally(async () => {
      if (released) await unlockOwner();
    });
  return shutdown;
}

await socketServer.listen(socketPath);
socketIdentity = await lstat(socketPath);
await chmod(socketPath, 0o600);
scheduleClose();
scheduleCache();
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    socketServer.disconnect();
    void close();
  });
