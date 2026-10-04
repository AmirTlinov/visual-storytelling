import type { PhysicsRuntime, PhysicsSnapshot } from './runtime.js';

/** Random access over the existing deterministic world; the host remains the only clock. */
function create(
  world: PhysicsRuntime,
  options: {
    duration: number;
    checkpointEvery?: number;
    maxCheckpoints?: number;
    beforeSeek?(): void;
    afterSeek?(): void;
  },
) {
  if (!Number.isFinite(options.duration) || options.duration <= 0)
    throw new Error('Replay duration must be positive');
  const every = options.checkpointEvery ?? 1,
    limit = options.maxCheckpoints ?? 32;
  if (!Number.isFinite(every) || every <= 0)
    throw new Error('Replay checkpoint interval must be positive');
  if (!Number.isSafeInteger(limit) || limit < 2)
    throw new Error('Replay needs at least two checkpoint slots');
  const stride = Math.max(1, Math.round(every / world.stepSeconds));
  let initial = world.snapshot(),
    disposed = false,
    currentTime = 0,
    currentStep = 0,
    dirty = false;
  const checkpoints = new Map<number, PhysicsSnapshot>([[0, initial]]);
  const stopWake = world.onWake(() => {
    dirty = true;
  });
  const dispose = () => {
    disposed = true;
    checkpoints.clear();
    stopWake();
    unbind();
  };
  const unbind = world.onDispose(dispose);
  return {
    duration: options.duration,
    get currentTime() {
      return currentTime;
    },
    seek(time: number) {
      if (disposed || world.disposed) throw new Error('Physics replay has been disposed');
      if (!Number.isFinite(time)) throw new Error('Replay time must be finite');
      options.beforeSeek?.();
      if (world.revision !== initial.revision)
        throw new Error('Physics topology changed; rebase the recording before seeking');
      const step = Math.round(Math.max(0, Math.min(options.duration, time)) / world.stepSeconds);
      let closest = 0;
      for (const index of checkpoints.keys()) if (index <= step && index > closest) closest = index;
      if (
        !dirty &&
        currentStep >= closest &&
        currentStep <= step &&
        Math.abs(world.time - initial.time - currentStep * world.stepSeconds) < 1e-8
      )
        closest = currentStep;
      else world.restore(checkpoints.get(closest)!);
      while (closest < step) {
        const next = Math.min(step, (Math.floor(closest / stride) + 1) * stride);
        world.step(next - closest);
        closest = next;
        if (closest % stride === 0 && !checkpoints.has(closest)) {
          checkpoints.set(closest, world.snapshot());
          if (checkpoints.size > limit)
            checkpoints.delete([...checkpoints.keys()].find((k) => k !== 0 && k !== closest)!);
        }
      }
      currentStep = step;
      dirty = false;
      currentTime = step * world.stepSeconds;
      options.afterSeek?.();
    },
    rebase() {
      if (disposed) throw new Error('Physics replay has been disposed');
      initial = world.snapshot();
      currentTime = 0;
      currentStep = 0;
      dirty = false;
      checkpoints.clear();
      checkpoints.set(0, initial);
    },
    dispose,
  };
}
export const PhysicsReplay = { create };
