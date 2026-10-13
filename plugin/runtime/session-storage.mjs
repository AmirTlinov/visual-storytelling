import { join } from 'node:path';
import { readJSON, writeJSON } from '../../tools/storage.mjs';

/** Persist checkpoints around the single in-memory SessionDirectory. */
export function sessionStorage(data, sessions, isClosing) {
  const saves = new Map(),
    loads = new Map();
  async function viewBuild(revision) {
    const build = await readJSON(join(data, 'builds', revision + '.json'));
    if (!build || build.revision !== revision || typeof build.html !== 'string')
      throw new Error('The saved build is unavailable. Rebuild the project.');
    return build;
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
        saved.generation < 0
      )
        throw new Error('The saved session is invalid.');
      const source = await readJSON(join(data, 'builds', saved.buildRevision + '.json'));
      if (!source || source.revision !== saved.buildRevision)
        throw new Error('The saved build is unavailable. Rebuild the project.');
      if (isClosing()) throw new Error('Runtime shutting down.');
      const session = sessions.open(source);
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
