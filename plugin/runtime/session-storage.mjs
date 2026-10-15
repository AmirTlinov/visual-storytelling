import { join } from 'node:path';
import { readJSON, writeJSON } from '../../tools/storage.mjs';
import { buildReference } from '../session-directory.mjs';
import { preparedBuildHTML, readPreparedBuild, readBuildMetadata } from '../build-payload.mjs';

/** Persist checkpoints around the single in-memory SessionDirectory. */
export function sessionStorage(data, sessions, isClosing, preserveInputs) {
  const saves = new Map(),
    loads = new Map();
  function viewBuild(revision) {
    return preserveInputs(async () => {
      const build = await readPreparedBuild(data, revision);
      if (!build || build.revision !== revision || !Array.isArray(build.presentation?.parts))
        throw new Error('The saved build is unavailable. Rebuild the project.');
      return { ...build, html: await preparedBuildHTML(data, build) };
    });
  }

  function load(id) {
    if (isClosing()) return Promise.reject(new Error('Runtime shutting down.'));
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
        saved.generation < 0 ||
        (saved.nextBuildRevision !== undefined &&
          !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(saved.nextBuildRevision)) ||
        [saved.authoredInputs, saved.nextAuthoredInputs].some(
          (keys) =>
            keys !== undefined &&
            (!Array.isArray(keys) ||
              keys.length > 64 ||
              keys.some((key) => typeof key !== 'string' || !key || key.length > 200)),
        )
      )
        throw new Error('The saved session is invalid.');
      const source = await readBuildMetadata(data, saved.buildRevision);
      if (!source || source.revision !== saved.buildRevision)
        throw new Error('The saved build is unavailable. Rebuild the project.');
      const next = saved.nextBuildRevision
        ? await readBuildMetadata(data, saved.nextBuildRevision)
        : undefined;
      if (saved.nextBuildRevision && !next)
        throw new Error('The saved candidate is unavailable. Rebuild the project.');
      if (isClosing()) throw new Error('Runtime shutting down.');
      const session = sessions.open(source);
      session.build.authoredInputs = saved.authoredInputs;
      if (next) {
        session.nextBuild = { ...buildReference(next), authoredInputs: saved.nextAuthoredInputs };
      }
      sessions.sessions.delete(session.id);
      Object.assign(session, {
        id,
        checkpoint: saved.checkpoint,
        generation: saved.generation,
        stateRevision: saved.stateRevision,
        observedAt: saved.observedAt,
        presentationMetrics: saved.presentationMetrics,
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
      authoredInputs: s.build.authoredInputs,
      nextBuildRevision: s.nextBuild?.revision,
      nextAuthoredInputs: s.nextBuild?.authoredInputs,
      checkpoint: s.checkpoint,
      generation: s.generation,
      stateRevision: s.stateRevision,
      observedAt: s.observedAt,
      presentationMetrics: s.presentationMetrics,
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

  return { load, save, viewBuild, drain: () => Promise.allSettled([...saves.values()]) };
}
