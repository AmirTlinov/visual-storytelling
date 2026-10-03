import type { PhysicsRuntime } from './runtime.js';

type Point = { x: number; y: number; z?: number };
interface Deformable<V> {
  numParticles(): number;
  particlePosition(index: number): V;
  isParticlePinned(index: number): boolean;
  setParticlePinned(index: number, pinned: boolean): void;
  setParticleKinematicTarget(index: number, point: V): void;
  wakeUp(): void;
}
/** Pin exactly the nearest particle and restore its prior pin state on every exit. */
export function deformableGrip<V extends Point>(
  world: PhysicsRuntime,
  soft: Deformable<V>,
  point: () => V,
) {
  let nearest = 0,
    best = Infinity,
    released = false;
  const target = point();
  for (let i = 0; i < soft.numParticles(); i++) {
    const p = soft.particlePosition(i);
    const d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2 + ((p.z ?? 0) - (target.z ?? 0)) ** 2;
    if (d < best) {
      nearest = i;
      best = d;
    }
  }
  const pinned = soft.isParticlePinned(nearest);
  soft.setParticlePinned(nearest, true);
  soft.wakeUp();
  const stop = world.beforeStep(() => soft.setParticleKinematicTarget(nearest, point()));
  world.wake();
  return () => {
    if (released) return;
    released = true;
    stop();
    soft.setParticlePinned(nearest, pinned);
    soft.wakeUp();
  };
}
