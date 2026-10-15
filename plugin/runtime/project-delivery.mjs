import { isDeepStrictEqual } from 'node:util';
import { prepareLiveProject } from '../live-project.mjs';
import { readBuildMetadata } from '../build-payload.mjs';
import { buildReference } from '../session-directory.mjs';
import { failure, errorData } from '../errors.mjs';
import { verifiedInputWork } from '../../tools/input-verification.mjs';

/** A hot edit retains the mounted model subjects; other identities need a candidate frame. */
export function samePreparedOwner(view, prepared) {
  return (
    view.build.live?.runtimeBuild === prepared.live?.runtimeBuild &&
    view.build.live?.moduleRevision === prepared.live?.moduleRevision &&
    isDeepStrictEqual(view.build.narration, prepared.narration) &&
    isDeepStrictEqual(
      view.build.live?.document.models.map(({ id, module }) => ({ id, module })),
      prepared.live?.document.models.map(({ id, module }) => ({ id, module })),
    )
  );
}

/** Deliver an accepted document through the existing scene owner and persist its acknowledgement. */
export function projectDelivery({
  data,
  toolchainRoot,
  projects,
  sessions,
  save,
  publishBuild,
  scheduleCache,
}) {
  return async function deliver({
    project,
    priorDelivery,
    accepted,
    preparedCandidate,
    requestId,
    phases = {},
    started = performance.now(),
  }) {
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
        (await prepareLiveProject(data, project, toolchainRoot));
      if (!preparedCandidate && !(await publishBuild(project, prepared, false)))
        throw failure('source_conflict', 'Source changed while resuming document delivery.');
    } catch (error) {
      const result = { project, shown, delivery: 'failed', error: errorData(error) };
      await projects.editDelivery(project.id, requestId, result);
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
        const began = performance.now();
        const observed =
          deliveredHere && session.build.revision === prepared.revision
            ? await sessions.request(session.id, { op: 'inspect' })
            : await sessions.request(
                session.id,
                {
                  op: 'author',
                  detail: 'model',
                  requestId: requestId,
                  buildRevision: session.build.revision,
                  stateRevision: session.stateRevision,
                  nextBuildRevision: prepared.revision,
                  sourceRevision: project.sourceRevision,
                  document: prepared.live.document,
                  authoredInputs: project.authoredInputs,
                },
                { authoredBuild: prepared },
              );
        phases.observe = (phases.observe ?? 0) + performance.now() - began;
        shown.push(observed);
        const checkpoint = performance.now();
        await save(session);
        phases.checkpoint = (phases.checkpoint ?? 0) + performance.now() - checkpoint;
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
    const result = {
      project,
      buildRevision: prepared.revision,
      work: {
        ...prepared.work,
        inputs: verifiedInputWork(),
        phases: { ...phases, toObservation: performance.now() - started },
      },
      shown,
      delivery,
    };
    await projects.editDelivery(project.id, requestId, result);
    scheduleCache();
    return result;
  };
}
