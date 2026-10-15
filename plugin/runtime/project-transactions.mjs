import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readJSON } from '../../tools/storage.mjs';
import { prepareLiveProject } from '../live-project.mjs';
import { readBuildMetadata } from '../build-payload.mjs';
import { authoredCandidate } from '../authored-candidate.mjs';
import { buildReference } from '../session-directory.mjs';
import { failure, errorData } from '../errors.mjs';

/** A hot edit retains the mounted model subjects; other identities need a candidate frame. */
export function samePreparedOwner(view, prepared) {
  return (
    view.build.live?.runtimeBuild === prepared.live?.runtimeBuild &&
    view.build.live?.moduleRevision === prepared.live?.moduleRevision &&
    isDeepStrictEqual(
      view.build.live?.document.models.map(({ id, module }) => ({ id, module })),
      prepared.live?.document.models.map(({ id, module }) => ({ id, module })),
    )
  );
}

/** One proposal/commit/delivery lifecycle; ProjectStore owns its source and receipt. */
export function projectTransactions({
  data,
  directory,
  projects,
  jobs,
  sessions,
  watched,
  save,
  scheduleCache,
}) {
  async function publishBuild(project, prepared, queueCandidate = true) {
    if ((await projects.inspect(project.id)).sourceRevision !== project.sourceRevision)
      return false;
    if (prepared.projectId !== project.id || prepared.sourceRevision !== project.sourceRevision)
      throw new Error('Prepared build does not belong to this authored revision.');
    await projects.update(project.id, { buildRevision: prepared.revision });
    watched.open(projects.get(project.id));
    if (queueCandidate)
      for (const session of sessions.sessions.values()) {
        if (session.build.projectId !== project.id || session.build.revision === prepared.revision)
          continue;
        if (session.nextBuild?.revision !== prepared.revision)
          session.nextBuild = {
            ...buildReference(prepared),
            ...(project.semantic && { authoredInputs: project.authoredInputs }),
          };
        session.wake?.();
        await save(session);
      }
    return true;
  }
  async function acceptCandidate(job, result) {
    const prepared = await readBuildMetadata(data, result.buildRevision);
    if (
      prepared?.projectId !== job.projectId ||
      prepared.sourceRevision !== job.sourceRevision ||
      result.sourceRevision !== job.sourceRevision
    )
      throw new Error('Preparation did not produce the proposed authored revision.');
    return commitPrepared(job.input.authoring, prepared, result);
  }
  async function commitPrepared(
    proposal,
    prepared,
    result = {
      buildRevision: prepared.revision,
      sourceRevision: prepared.sourceRevision,
      snapshot: prepared.snapshot,
    },
    queueCandidate = true,
  ) {
    if (
      prepared?.projectId !== proposal.args.projectId ||
      prepared.revision !== result.buildRevision ||
      prepared.sourceRevision !== result.sourceRevision
    )
      throw new Error('Prepared artifact does not match the authored proposal.');
    const { creation, migration, ...artifact } = result;
    const project = await projects.commitPreparedEdit({
      ...proposal,
      delivery: { ...artifact, delivery: 'pending' },
    });
    return deliverPrepared(project, proposal.args.requestId, prepared, result, queueCandidate);
  }
  async function deliverPrepared(project, requestId, prepared, result, queueCandidate = true) {
    const { error: previousError, ...artifact } = result;
    let response;
    try {
      const published = await publishBuild(project, prepared, queueCandidate);
      response = { ...artifact, project, delivery: published ? 'pending' : 'superseded' };
    } catch (error) {
      // Source is accepted. Keep the prepared artifact so a repeat resumes delivery.
      response = { ...artifact, project, delivery: 'failed', error: errorData(error) };
    }
    await projects.editDelivery(project.id, requestId, response);
    return response;
  }
  async function resumeCommitted(projectId, requestId, queueCandidate = true) {
    const receipt = await projects.editDelivery(projectId, requestId);
    if (!receipt?.buildRevision) return;
    if (['shown', 'prepared', 'superseded'].includes(receipt.delivery)) return receipt;
    if ((await projects.inspect(projectId)).sourceRevision !== receipt.project.sourceRevision) {
      const superseded = { ...receipt, delivery: 'superseded' };
      await projects.editDelivery(projectId, requestId, superseded);
      return superseded;
    }
    const prepared = await readBuildMetadata(data, receipt.buildRevision);
    if (
      prepared?.projectId !== projectId ||
      prepared.sourceRevision !== receipt.project.sourceRevision
    )
      throw new Error('The accepted transaction has no matching prepared artifact.');
    return deliverPrepared(receipt.project, requestId, prepared, receipt, queueCandidate);
  }
  async function acceptMigration(job, result) {
    const proposal = await projects.stageEdit({
      projectId: job.projectId,
      sourceRevision: job.sourceRevision,
      requestId: job.id + '-migration',
      ...result.migration,
    });
    if (!proposal.prior) {
      const candidate = await jobs.preserveInputs(() =>
        authoredCandidate(data, projects.get(job.projectId), proposal),
      );
      try {
        if (candidate.input.sourceRevision !== result.sourceRevision)
          throw new Error('Migration artifact does not match its proposed source and pin.');
      } finally {
        await rm(candidate.snapshot, { recursive: true, force: true });
      }
    }
    return acceptCandidate(
      {
        ...job,
        sourceRevision: result.sourceRevision,
        input: { ...job.input, authoring: proposal },
      },
      result,
    );
  }
  async function prepareDocument({ project, sourceRevision, document, operations }) {
    const view = [...sessions.sessions.values()].find(
      (session) =>
        session.build.projectId === project.id &&
        session.build.sourceRevision === sourceRevision &&
        session.build.live &&
        session.renderer &&
        session.ready &&
        !sessions.expired(session),
    );
    if (!view)
      throw failure(
        'view_closed',
        'Open the current working revision before editing its authored modules.',
        { action: 'story_open' },
      );
    const response = await sessions.request(view.id, {
      op: 'author-prepare',
      buildRevision: view.build.revision,
      stateRevision: view.stateRevision,
      document,
      operations,
    });
    if (!response.result?.document) throw new Error('The module owner did not prepare a document.');
    return response.result.document;
  }
  return {
    prepareDocument,
    publishBuild,
    commitPrepared,
    resumeCommitted,
    acceptCandidate: (job, result) =>
      projects.serial('delivery:' + job.projectId, () => acceptCandidate(job, result)),
    acceptMigration: (job, result) =>
      projects.serial('delivery:' + job.projectId, () => acceptMigration(job, result)),
    async edit(args) {
      return projects.serial('delivery:' + args.projectId, () =>
        jobs.preserveInputs(async () => {
          const previousBuild = jobs.forRequest(args.requestId + '-build');
          if (previousBuild?.input.authoring) {
            if (!isDeepStrictEqual(previousBuild.input.authoring.args, args))
              throw new Error('requestId already belongs to a different edit.');
            if (
              !['queued', 'running', 'cancelling'].includes(previousBuild.status) &&
              (!previousBuild.result || previousBuild.result.delivery === 'failed')
            ) {
              const resumed = await resumeCommitted(args.projectId, args.requestId);
              if (resumed)
                return {
                  ...resumed,
                  job: await jobs.acceptPreparedResult(previousBuild.id, resumed),
                };
            }
            return {
              project: {
                ...(previousBuild.result?.project ?? previousBuild.input.baseProject),
                repeated: true,
              },
              job: jobs.describe(previousBuild),
            };
          }
          const proposed = await projects.stageEdit(args, prepareDocument);
          const voiced =
            (await readJSON(join(projects.get(args.projectId).path, 'voice.json')))?.enabled ===
            true;
          if (!proposed.prior && (!proposed.semantic || voiced)) {
            const project = await projects.inspect(args.projectId);
            const candidate = await authoredCandidate(data, project, proposed);
            try {
              const job = await jobs.enqueue(
                'build',
                { data, ...candidate.input, authoring: proposed, baseProject: project },
                args.requestId + '-build',
              );
              return { project, job, publication: 'preparing' };
            } catch (error) {
              await rm(candidate.snapshot, { recursive: true, force: true });
              throw error;
            }
          }
          let preparedCandidate;
          if (proposed.semantic) {
            const views = [...sessions.sessions.values()].filter(
              (session) =>
                session.build.projectId === args.projectId &&
                session.build.live &&
                session.renderer &&
                session.ready &&
                !sessions.expired(session),
            );
            if (!views.length)
              throw failure(
                'view_closed',
                'Open this project with story_open(projectId) and wait for its ready frame before a semantic edit.',
                { action: 'story_open' },
              );
            const project = await projects.inspect(args.projectId);
            const candidate = await authoredCandidate(data, project, proposed);
            try {
              preparedCandidate = await prepareLiveProject(
                data,
                {
                  ...project,
                  path: candidate.snapshot,
                  sourceRevision: candidate.input.sourceRevision,
                },
                resolve(directory, '../..'),
              );
            } finally {
              await rm(candidate.snapshot, { recursive: true, force: true });
            }
            for (const session of views.filter((view) =>
              samePreparedOwner(view, preparedCandidate),
            ))
              await sessions.request(session.id, {
                op: 'author-validate',
                buildRevision: session.build.revision,
                stateRevision: session.stateRevision,
                document: proposed.document,
                authoredInputs: proposed.authoredInputs,
              });
          }
          const accepted = preparedCandidate
            ? await commitPrepared(proposed, preparedCandidate, undefined, false)
            : { project: await projects.commitPreparedEdit(proposed) };
          const project = accepted.project;
          const priorDelivery =
            project.repeated && (await projects.editDelivery(args.projectId, args.requestId));
          if (project.semantic) {
            if (
              priorDelivery?.shown?.length &&
              priorDelivery.shown.every(
                (view) =>
                  !view.error &&
                  view.acknowledgement === 'rendered' &&
                  view.shownSourceRevision === project.sourceRevision,
              )
            )
              return priorDelivery;
            if ((await projects.inspect(project.id)).sourceRevision !== project.sourceRevision)
              return {
                project,
                shown: [],
                delivery: 'superseded',
                message:
                  'This operation was saved before a newer edit. Its interrupted delivery is not replayed.',
              };
            let prepared;
            const shown = [];
            try {
              if (accepted.delivery === 'failed') return { ...accepted, shown };
              prepared =
                preparedCandidate ??
                (priorDelivery?.buildRevision &&
                  (await readBuildMetadata(data, priorDelivery.buildRevision))) ??
                (await prepareLiveProject(data, project, resolve(directory, '../..')));
              if (!preparedCandidate && !(await publishBuild(project, prepared, false)))
                throw failure(
                  'source_conflict',
                  'Source changed while resuming document delivery.',
                );
            } catch (error) {
              const result = { project, shown, delivery: 'failed', error: errorData(error) };
              await projects.editDelivery(args.projectId, args.requestId, result);
              return result;
            }
            for (const session of sessions.sessions.values()) {
              if (session.build.projectId !== project.id || !session.build.live) continue;
              if (!session.renderer || !session.ready || sessions.expired(session)) continue;
              if (!samePreparedOwner(session, prepared)) {
                session.nextBuild = {
                  ...buildReference(prepared),
                  authoredInputs: project.authoredInputs,
                };
                session.wake?.();
                await save(session);
                shown.push({ ...sessions.describe(session), acknowledgement: 'pending' });
                continue;
              }
              try {
                const deliveredHere = priorDelivery?.shown?.some(
                  (view) =>
                    !view.error &&
                    view.sessionId === session.id &&
                    view.buildRevision === prepared.revision &&
                    ['rendered', 'prepared', 'failed'].includes(view.acknowledgement),
                );
                const observed =
                  deliveredHere && session.build.revision === prepared.revision
                    ? await sessions.request(session.id, { op: 'inspect' })
                    : await sessions.request(
                        session.id,
                        {
                          op: 'author',
                          detail: 'model',
                          requestId: args.requestId,
                          buildRevision: session.build.revision,
                          stateRevision: session.stateRevision,
                          nextBuildRevision: prepared.revision,
                          sourceRevision: project.sourceRevision,
                          document: prepared.live.document,
                          authoredInputs: project.authoredInputs,
                        },
                        { authoredBuild: prepared },
                      );
                shown.push(observed);
                await save(session);
              } catch (error) {
                shown.push({
                  sessionId: session.id,
                  error: errorData(error),
                  shownSourceRevision: sessions.describe(session).shownSourceRevision,
                });
              }
            }
            const delivery = !shown.length
              ? 'pending'
              : shown.every((view) => !view.error && view.acknowledgement === 'rendered')
                ? 'shown'
                : shown.some((view) => view.error || view.acknowledgement === 'failed')
                  ? 'failed'
                  : shown.some((view) => view.acknowledgement === 'pending')
                    ? 'pending'
                    : 'prepared';
            const result = { project, buildRevision: prepared.revision, shown, delivery };
            await projects.editDelivery(args.projectId, args.requestId, result);
            scheduleCache();
            return result;
          }
          return (
            priorDelivery ?? {
              project,
              shown: [],
              delivery: 'superseded',
              message: 'This historical edit has no pending preparation to resume.',
            }
          );
        }),
      );
    },
    async migrate({ projectId, sourceRevision, requestId, changes }) {
      return projects.serial('revision:' + requestId, async () => {
        const previous = jobs.forRequest(requestId);
        if (previous) {
          if (
            previous.kind !== 'migrate' ||
            previous.projectId !== projectId ||
            previous.sourceRevision !== sourceRevision ||
            !isDeepStrictEqual(previous.input.changes, changes)
          )
            throw new Error('requestId already belongs to another preparation.');
          if (
            !['queued', 'running', 'cancelling'].includes(previous.status) &&
            (!previous.result || previous.result.delivery === 'failed')
          ) {
            const resumed = await projects.serial('delivery:' + projectId, () =>
              resumeCommitted(projectId, previous.id + '-migration'),
            );
            if (resumed) return jobs.acceptPreparedResult(previous.id, resumed);
          }
          return jobs.describe(previous);
        }
        const project = await projects.inspect(projectId);
        if (sourceRevision !== project.sourceRevision)
          throw new Error('Project changed. Inspect its source before migrating.');
        return jobs.enqueue(
          'migrate',
          {
            data,
            projectId,
            projectPath: project.path,
            title: project.title,
            sourceRevision,
            changes,
          },
          requestId,
        );
      });
    },
  };
}
