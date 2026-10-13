import { realpath, rm } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readJSON } from '../../tools/storage.mjs';
import { creationCandidate } from '../authored-candidate.mjs';
import { prepareLiveProject } from '../live-project.mjs';
import { prepareIllustratedDocument } from '../../dist/story/document.js';
import { failure, errorData } from '../errors.mjs';

/** Creation and card navigation retain their durable identity in ProjectStore/SessionDirectory. */
export function projectCreation({
  data,
  directory,
  projects,
  jobs,
  sessions,
  preferences,
  load,
  save,
  decorate,
  scheduleCache,
  navigate,
  commitPrepared,
}) {
  async function createLiveProject(project, input, requestId) {
    return projects.serial('delivery:' + project.id, () =>
      jobs.preserveInputs(async () => {
        const existing = await readJSON(join(project.path, 'package.json'));
        let authored, prepared;
        if (existing) {
          const receipt = await projects.editDelivery(project.id, requestId);
          prepared =
            receipt?.buildRevision &&
            (await readJSON(join(data, 'builds', receipt.buildRevision + '.json')));
          if (
            !prepared ||
            (await projects.inspect(project.id)).sourceRevision !== prepared.sourceRevision
          )
            throw failure(
              'creation_conflict',
              'The accepted creation is unavailable or its source changed.',
            );
          authored = receipt.project;
        } else {
          const candidate = await creationCandidate(data, project, {
            root: resolve(directory, '../..'),
            title: input.title,
            document: input.document,
            example: input.example,
          });
          try {
            prepared = await prepareLiveProject(data, {
              ...project,
              path: candidate.snapshot,
              sourceRevision: candidate.sourceRevision,
            });
            const proposal = await projects.stageCreation({
              projectId: project.id,
              sourceRevision: project.sourceRevision,
              requestId,
              changes: candidate.changes,
              assets: candidate.assets,
            });
            authored = (await commitPrepared(proposal, prepared)).project;
          } finally {
            await rm(candidate.snapshot, { recursive: true, force: true });
          }
        }
        const pendingSession = projects.get(project.id).creation?.sessionId ?? randomUUID();
        // Choose the durable identity before opening an in-memory scene. A failed registry
        // write must not leave an unregistered session which a retry could duplicate.
        await projects.update(project.id, {
          creation: { requestId, input, sessionId: pendingSession },
        });
        let session;
        if (
          sessions.sessions.has(pendingSession) ||
          (await readJSON(join(data, 'sessions', pendingSession + '.json')))
        )
          session = await load(pendingSession);
        else {
          session = sessions.open(prepared);
          sessions.sessions.delete(session.id);
          session.id = pendingSession;
          sessions.sessions.set(session.id, session);
        }
        await save(session);
        const receipt = { ...decorate(session), project: authored, authoring: 'ready' };
        await projects.update(project.id, {
          lastSessionId: session.id,
          creation: { requestId, input, sessionId: session.id, receipt },
        });
        scheduleCache();
        return receipt;
      }),
    );
  }

  async function rememberCreationDelivery(projectId, delivery) {
    await projects.update(projectId, (project) => {
      if (project.creation.delivery?.result.delivery === 'shown') return;
      return { creation: { ...project.creation, delivery } };
    });
  }

  // The existing frame-report channel completes navigation delivery without another agent call.
  async function observeCreationDelivery(session) {
    if (!session.build.projectId) return;
    await projects.update(session.build.projectId, (project) => {
      const creation = project.creation;
      const previous = creation?.delivery;
      // SessionDirectory owns attach/generation and validates every incoming report.
      // A remount can replace the renderer while retaining this exact creation.
      // Recheck its current observation inside the registry queue before publishing.
      if (
        !previous ||
        previous.result.delivery === 'shown' ||
        creation.sessionId !== session.id ||
        !session.renderer ||
        !session.ready ||
        sessions.expired(session) ||
        session.build.sourceRevision !== creation.receipt.sourceRevision
      )
        return;
      const delivery =
        session.renderStatus === 'rendered'
          ? 'shown'
          : session.renderStatus === 'prepared'
            ? 'prepared'
            : 'failed';
      if (
        previous.result.delivery === delivery &&
        previous.renderer === session.renderer &&
        previous.generation === session.generation
      )
        return;
      return {
        creation: {
          ...creation,
          delivery: {
            renderer: session.renderer,
            generation: session.generation,
            result: {
              delivery,
              shown: [{ ...sessions.describe(session), acknowledgement: session.renderStatus }],
            },
          },
        },
      };
    });
  }

  async function deliverCreatedDocument(receipt, fromSessionId) {
    if (!fromSessionId) return receipt;
    const projectId = receipt.project.id;
    const response = () => ({
      ...receipt,
      presentation: { kind: 'existing-card', fromSessionId },
      ...projects.get(projectId).creation.delivery.result,
    });
    const previous = projects.get(projectId).creation.delivery;
    if (previous?.result.delivery === 'shown') return response();
    try {
      const destination = await load(receipt.sessionId);
      await observeCreationDelivery(destination);
      if (projects.get(projectId).creation.delivery?.result.delivery === 'shown') return response();
      // The exact destination may have remounted since navigation. Its current
      // attachment owns delivery, even before the first report can rebind the receipt.
      if (
        destination.renderer &&
        !sessions.expired(destination) &&
        destination.build.sourceRevision === receipt.sourceRevision
      )
        return response();
      const source = await load(fromSessionId);
      if (!source.renderer || !source.ready || sessions.expired(source))
        throw failure(
          'view_closed',
          'Open the original card and wait for its ready frame, then retry the same requestId.',
          { action: 'story_open' },
        );
      if (source.navigation && source.navigation.sessionId !== receipt.sessionId)
        throw failure(
          'navigation_conflict',
          'The original card is already opening another document.',
        );
      await rememberCreationDelivery(projectId, {
        renderer: source.renderer,
        result: { delivery: 'pending', shown: [] },
      });
      const destinationResult = await navigate({
        sessionId: fromSessionId,
        target: { sessionId: receipt.sessionId },
      });
      if (destinationResult.sessionId !== receipt.sessionId)
        throw failure('navigation_conflict', 'The original card opened another document.');
      return response();
    } catch (error) {
      const current = projects.get(projectId).creation.delivery;
      if (current?.result.delivery !== 'shown')
        await rememberCreationDelivery(projectId, {
          ...current,
          result: { delivery: 'failed', shown: [], error: errorData(error) },
        });
      return response();
    }
  }

  async function createdProject(job) {
    const prepared = await jobs.wait(job.id, { timeout: 15000 });
    return {
      project: prepared.result?.project ?? (await projects.inspect(job.projectId)),
      job: prepared,
      authoring:
        prepared.status === 'succeeded'
          ? 'ready'
          : ['failed', 'cancelled', 'interrupted'].includes(prepared.status)
            ? 'failed'
            : 'preparing',
    };
  }
  return {
    observeCreationDelivery,
    async acceptCreationJob(job, result) {
      return projects.serial('delivery:' + job.projectId, async () => {
        const prepared = await readJSON(join(data, 'builds', result.buildRevision + '.json'));
        const proposal = await projects.stageCreation({
          projectId: job.projectId,
          sourceRevision: job.input.baseProject.sourceRevision,
          requestId: job.input.creationRequestId,
          ...result.creation,
        });
        const response = await commitPrepared(proposal, prepared, result);
        const creation = projects.get(job.projectId).creation;
        await projects.update(job.projectId, {
          creation: {
            ...creation,
            receipt: { project: response.project, authoring: 'ready', jobId: job.id },
          },
        });
        return response;
      });
    },
    async create({ path, title = 'Новое объяснение', example, document, requestId, sessionId }) {
      if (sessionId !== undefined && document === undefined)
        throw new Error(
          'sessionId requires a prepared document; source-code scaffolds and examples open after preparation.',
        );
      if (document !== undefined) {
        if (example !== undefined) throw new Error('Choose a story document or a copied example.');
        document = prepareIllustratedDocument(document).document;
      }
      return projects.serial('create:' + requestId, async () => {
        const requestedPath = path;
        if (path && !isAbsolute(path)) throw new Error('Choose an absolute project path.');
        const previousLive = projects.creation(requestId);
        if (previousLive && document !== undefined) {
          const requested = {
            title,
            ...(example !== undefined ? { example } : {}),
            ...(document !== undefined ? { document } : {}),
            ...(sessionId !== undefined ? { sessionId } : {}),
            ...(path ? { path: await projects.canonicalPath(path) } : {}),
          };
          if (!isDeepStrictEqual(previousLive.creation.input, requested))
            throw new Error('requestId already belongs to another project creation.');
          if (!previousLive.creation.receipt)
            await projects.create(previousLive.path, {
              title,
              example,
              creation: { requestId, input: requested },
            });
          const receipt =
            previousLive.creation.receipt ??
            (await createLiveProject(previousLive, requested, requestId));
          return deliverCreatedDocument(receipt, sessionId);
        }
        const previous = jobs.forRequest(requestId);
        if (previousLive?.creation.receipt && document === undefined) {
          const requested = {
            title,
            ...(example !== undefined ? { example } : {}),
            ...(path ? { path: await projects.canonicalPath(path) } : {}),
          };
          if (!isDeepStrictEqual(previousLive.creation.input, requested))
            throw new Error('requestId already belongs to another project creation.');
          return {
            ...previousLive.creation.receipt,
            job: jobs.get(previousLive.creation.receipt.jobId),
          };
        }
        if (previous) {
          if (
            previous.kind !== 'create' ||
            document !== undefined ||
            previous.input.title !== title ||
            previous.input.example !== example ||
            (path && previous.input.projectPath !== (await realpath(path)))
          )
            throw new Error('requestId already belongs to another project creation.');
          return createdProject(previous);
        }
        path ??= join(
          (await preferences.read()).projectsDirectory,
          `${title.replace(/[^\p{L}\p{N}-]+/gu, '-').slice(0, 60)}-${randomUUID().slice(0, 8)}`,
        );
        const catalog = await readJSON(join(directory, 'catalog.json'));
        if (example !== undefined && !Object.hasOwn(catalog, example))
          throw new Error(
            'Unknown example. Omit example for an empty project or use story_help to inspect the exemplar.',
          );
        const input = {
          title,
          ...(example !== undefined ? { example } : {}),
          ...(document !== undefined ? { document } : {}),
          ...(sessionId !== undefined ? { sessionId } : {}),
          ...(requestedPath ? { path } : {}),
        };
        if (previousLive) path = previousLive.path;
        const project = await projects.create(path, {
          title,
          example,
          creation: { requestId, input },
        });
        if (document !== undefined) {
          const input = projects.get(project.id).creation.input;
          return deliverCreatedDocument(
            await createLiveProject(project, input, requestId),
            sessionId,
          );
        }
        const job = await jobs.enqueue(
          'create',
          {
            data,
            projectPath: project.path,
            projectId: project.id,
            title,
            example,
            baseProject: project,
            sourceRevision: project.sourceRevision,
            creationRequestId: requestId,
          },
          requestId,
        );
        return createdProject(job);
      });
    },
  };
}
