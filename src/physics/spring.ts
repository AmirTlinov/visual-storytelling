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

/** Exact response to a constant load over one step. This spring is also usable
 * without a Rapier world for precomputed, seekable material deformation. */
export function dampedSpring(frequency: number, dampingRatio: number) {
  const omega = 2 * Math.PI * positive(frequency, 'Spring frequency'),
    stiffness = positive(omega * omega, 'Spring stiffness');
  if (!(dampingRatio > 0 && dampingRatio < 1))
    throw new Error('An elastic response needs a damping ratio between zero and one');
  const decay = dampingRatio * omega,
    rotation = omega * Math.sqrt(1 - dampingRatio * dampingRatio);
  return {
    stiffness,
    settlingTime: -Math.log(0.001) / decay,
    step(position: number, velocity: number, equilibrium: number, dt: number): [number, number] {
      const offset = position - equilibrium,
        envelope = Math.exp(-decay * dt),
        cosine = Math.cos(rotation * dt),
        sine = Math.sin(rotation * dt) / rotation;
      return [
        equilibrium + envelope * (offset * cosine + (velocity + decay * offset) * sine),
        envelope * (velocity * cosine - (decay * velocity + stiffness * offset) * sine),
      ];
    },
  };
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
