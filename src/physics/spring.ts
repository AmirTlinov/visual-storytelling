import type { PhysicsRuntime } from './runtime.js';
import { positive } from './materials.js';

export interface SpringOptions {
  length?: number;
  stiffness?: number;
  damping?: number;
}
export function springSettings(a: readonly number[], b: readonly number[], options: SpringOptions) {
  const length = options.length ?? Math.hypot(...a.map((value, i) => value - b[i]!));
  if (!Number.isFinite(length) || length < 0) throw new Error('Spring length must be non-negative');
  const damping = options.damping ?? 3;
  if (!Number.isFinite(damping) || damping < 0)
    throw new Error('Spring damping must be non-negative');
  return { length, stiffness: positive(options.stiffness ?? 30, 'Spring stiffness'), damping };
}

/** Explicit removal and world teardown use the same idempotent constraint owner. */
export function springLifetime(
  world: PhysicsRuntime,
  bodies: readonly { onDispose(cleanup: () => void): () => void }[],
  remove: () => void,
) {
  let disposed = false;
  world.topologyChanged();
  const off = world.onDispose(dispose);
  const stopBodies = bodies.map((body) => body.onDispose(dispose));
  function dispose() {
    if (disposed) return;
    disposed = true;
    off();
    for (const stop of stopBodies) stop();
    remove();
    world.topologyChanged();
  }
  return { dispose };
}
