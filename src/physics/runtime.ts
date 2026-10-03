interface SnapshotWorld {
  timestep: number;
  step(): void;
  takeSnapshot(): Uint8Array;
  free(): void;
}
export interface PhysicsSnapshot {
  readonly data: Uint8Array;
  readonly time: number;
  readonly remainder: number;
  readonly revision: number;
  readonly owner: object;
}
export interface Participant {
  awake(): boolean;
  dispose(): void;
}

/** Fixed simulation steps; the existing transport owns animation time. No private RAF. */
export function physicsRuntime<W extends SnapshotWorld>(
  initial: W,
  restore: (data: Uint8Array) => W,
) {
  let raw = initial,
    time = 0,
    remainder = 0,
    revision = 0,
    disposed = false,
    disposing = false;
  const owner = {},
    participants = new Map<string, Participant>();
  const renders = new Set<() => void>(),
    beforeStep = new Set<() => void>();
  const wakeListeners = new Set<() => void>(),
    cleanups = new Set<() => void>();
  const checkpointListeners = new Set<() => void>();
  const dt = 1 / 120;
  raw.timestep = dt;
  function assertLive() {
    if (disposed) throw new Error('Physics world has been disposed');
  }
  function sync() {
    if (!disposed && !disposing) for (const render of renders) render();
  }
  function wake() {
    assertLive();
    for (const listener of wakeListeners) listener();
  }
  function integrate() {
    for (const update of beforeStep) update();
    raw.step();
    time += dt;
  }
  return {
    get raw() {
      assertLive();
      return raw;
    },
    get time() {
      return time;
    },
    get sleeping() {
      return [...participants.values()].every((body) => !body.awake());
    },
    get disposed() {
      return disposed;
    },
    get size() {
      return participants.size;
    },
    get revision() {
      return revision;
    },
    topologyChanged() {
      assertLive();
      revision++;
    },
    reserve(id: string) {
      assertLive();
      if (!id || participants.has(id)) throw new Error(`Physical body id must be unique: ${id}`);
    },
    track(id: string, body: Participant) {
      this.reserve(id);
      participants.set(id, body);
      revision++;
      return () => {
        if (participants.delete(id)) revision++;
      };
    },
    step(count = 1) {
      assertLive();
      if (!Number.isSafeInteger(count) || count < 0)
        throw new Error('Step count must be a non-negative integer');
      for (let i = 0; i < count; i++) integrate();
      sync();
    },
    /** Seconds since the previous frame. Catch-up is bounded after suspension. */
    advance(seconds: number) {
      assertLive();
      if (!Number.isFinite(seconds) || seconds < 0)
        throw new Error('Elapsed time must be finite and non-negative');
      remainder += Math.min(seconds, 0.1);
      let steps = 0;
      while (remainder + 1e-10 >= dt) {
        integrate();
        remainder = Math.max(0, remainder - dt);
        steps++;
      }
      if (steps) sync();
      return steps > 0;
    },
    snapshot(): PhysicsSnapshot {
      assertLive();
      for (const cancel of checkpointListeners) cancel();
      return { data: raw.takeSnapshot(), time, remainder, revision, owner };
    },
    restore(snapshot: PhysicsSnapshot) {
      assertLive();
      if (snapshot.owner !== owner || snapshot.revision !== revision)
        throw new Error('A physics snapshot belongs to the same world and set of bodies');
      for (const cancel of checkpointListeners) cancel();
      const next = restore(snapshot.data);
      raw.free();
      raw = next;
      raw.timestep = dt;
      time = snapshot.time;
      remainder = snapshot.remainder;
      sync();
    },
    onRender(render: () => void) {
      assertLive();
      render();
      renders.add(render);
      return () => {
        renders.delete(render);
      };
    },
    beforeStep(update: () => void) {
      assertLive();
      beforeStep.add(update);
      return () => {
        beforeStep.delete(update);
      };
    },
    onWake(listener: () => void) {
      assertLive();
      wakeListeners.add(listener);
      return () => {
        wakeListeners.delete(listener);
      };
    },
    beforeCheckpoint(cancel: () => void) {
      assertLive();
      checkpointListeners.add(cancel);
      return () => {
        checkpointListeners.delete(cancel);
      };
    },
    onDispose(cleanup: () => void) {
      assertLive();
      cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
      };
    },
    sync,
    wake,
    dispose() {
      if (disposed || disposing) return;
      disposing = true;
      for (const cleanup of [...cleanups]) cleanup();
      for (const body of [...participants.values()]) body.dispose();
      participants.clear();
      renders.clear();
      beforeStep.clear();
      wakeListeners.clear();
      cleanups.clear();
      checkpointListeners.clear();
      raw.free();
      disposed = true;
    },
  };
}
export type PhysicsRuntime = ReturnType<typeof physicsRuntime>;
