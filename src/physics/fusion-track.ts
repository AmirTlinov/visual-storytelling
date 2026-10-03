import R from '@dimforge/rapier2d-compat';
import type { FusionFrame } from '../ink/fusion/surface.js';
import type { inkMotion, InkPatch, InkVertices } from '../ink/fusion/motion.js';
import type { World2D } from './world2d.js';
import { bodyLifetime } from './body.js';

const STEP = 1 / 120;
const SCALE = 100;
const origin = { x: 0, y: 0 };

function bounds(vertices: InkVertices, patch: InkPatch, out: Float64Array) {
  const data = vertices[patch.source];
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const [offset, length] of patch.ranges)
    for (let i = offset; i < offset + length; i += 6) {
      left = Math.min(left, data[i]!, data[i + 2]!);
      right = Math.max(right, data[i]!, data[i + 2]!);
      top = Math.min(top, data[i + 1]!, data[i + 3]!);
      bottom = Math.max(bottom, data[i + 1]!, data[i + 3]!);
    }
  out[0] = (left + right) / 2;
  out[1] = (top + bottom) / 2;
  out[2] = Math.max(6, (right - left) / 2);
  out[3] = Math.max(6, (bottom - top) / 2);
}

/** A small Rapier cage carries each incoming word. Cached cage offsets make seeking deterministic. */
export function fusionTrack(
  world: World2D,
  motion: ReturnType<typeof inkMotion>,
  frame: (seconds: number) => FusionFrame,
  duration: number,
  softness = 5,
) {
  if (!(duration > 0 && softness > 0) || !Number.isFinite(duration + softness))
    throw new Error('Fusion duration and softness must be positive and finite');
  let disposed = false,
    lastStep = 0;
  const sample = (time: number) => {
    const f = frame(time);
    return motion(f.sources, f.target ?? origin, Math.max(0, Math.min(1, f.morph ?? 0)));
  };
  const initial = sample(0);
  const output: InkVertices = [
    new Float32Array(initial[0].length),
    new Float32Array(initial[1].length),
  ];
  const cages = motion.patches.map((patch, index) => {
    const box = new Float64Array(4);
    bounds(initial, patch, box);
    const center = { x: box[0]! / SCALE, y: box[1]! / SCALE };
    const body = world.raw.createSoftBody(
      R.SoftBodyDesc.grid(center, { x: box[2]! / SCALE, y: box[3]! / SCALE }, 3, 3)
        .setSoftness(softness, 0.95)
        .setShapeMatching(true)
        .setLinearDamping(2)
        .setCanSleep(false)
        .setSurfaceCollider(R.ColliderDesc.ball(0.01).setCollisionGroups(0)),
    );
    const rest = body.particlePositions(),
      nodes = new Uint8Array(9);
    for (let i = 0; i < 9; i++) {
      rest[i * 2]! -= center.x;
      rest[i * 2 + 1]! -= center.y;
      const column = Math.round((rest[i * 2]! * SCALE) / box[2]! + 1);
      const row = Math.round((rest[i * 2 + 1]! * SCALE) / box[3]! + 1);
      nodes[row * 3 + column] = i;
    }
    body.setParticlePinned(nodes[4]!, true);
    const life = bodyLifetime(world, `fusion:${index}`, {
      awake: () => !body.isSleeping(),
      remove: () => world.raw.removeSoftBody(body),
    });
    return { patch, box, body, rest, nodes, life, limit: box[3]! * 0.4, target: center };
  });
  const history = [new Float32Array(cages.length * 18)];
  function extend(step: number) {
    while (lastStep < step) {
      const next = ++lastStep;
      const geometry = sample(Math.min(duration, next * STEP));
      for (const cage of cages) {
        bounds(geometry, cage.patch, cage.box);
        cage.target.x = cage.box[0]! / SCALE;
        cage.target.y = cage.box[1]! / SCALE;
        cage.body.setParticleKinematicTarget(cage.nodes[4]!, cage.target);
      }
      world.step();
      const offsets = new Float32Array(cages.length * 18);
      for (let j = 0; j < cages.length; j++) {
        const cage = cages[j]!,
          positions = cage.body.particlePositions();
        for (let n = 0; n < 9; n++) {
          const i = cage.nodes[n]! * 2;
          const dx = (positions[i]! - cage.target.x - cage.rest[i]!) * SCALE;
          const dy = (positions[i + 1]! - cage.target.y - cage.rest[i + 1]!) * SCALE;
          // Bound elastic displacement by the letter height, with a smooth saturation.
          const weight = cage.limit / Math.sqrt(cage.limit ** 2 + dx * dx + dy * dy);
          offsets[j * 18 + n * 2] = dx * weight;
          offsets[j * 18 + n * 2 + 1] = dy * weight;
        }
      }
      history.push(offsets);
    }
  }
  const deltas = new Float32Array(cages.length * 18);
  return {
    sample(time: number) {
      if (disposed || world.disposed) throw new Error('Fusion track has been disposed');
      if (!Number.isFinite(time)) throw new Error('Fusion time must be finite');
      time = Math.max(0, Math.min(duration, time));
      const f = frame(time),
        morph = Math.max(0, Math.min(1, f.morph ?? 0));
      // Exact endpoints need no simulation, including a first seek straight to the result.
      if (morph === 0 || morph === 1) {
        const geometry = motion(f.sources, f.target ?? origin, morph);
        output[0].set(geometry[0]);
        output[1].set(geometry[1]);
        return output;
      }
      const tick = time / STEP,
        low = Math.floor(tick),
        high = Math.ceil(tick),
        fraction = tick - low;
      extend(high);
      const a = history[low]!,
        b = history[high]!;
      for (let i = 0; i < deltas.length; i++) deltas[i] = a[i]! + (b[i]! - a[i]!) * fraction;
      const geometry = motion(f.sources, f.target ?? origin, morph);
      output[0].set(geometry[0]);
      output[1].set(geometry[1]);
      const strength = 0.7 * 16 * morph * morph * (1 - morph) * (1 - morph);
      for (let j = 0; j < cages.length; j++) {
        const cage = cages[j]!;
        bounds(geometry, cage.patch, cage.box);
        const data = output[cage.patch.source],
          base = j * 18;
        for (const [offset, length] of cage.patch.ranges)
          for (let i = offset; i < offset + length; i += 6)
            for (let end = 0; end < 4; end += 2) {
              const at = i + end;
              const u = Math.max(0, Math.min(2, (data[at]! - cage.box[0]!) / cage.box[2]! + 1));
              const v = Math.max(0, Math.min(2, (data[at + 1]! - cage.box[1]!) / cage.box[3]! + 1));
              const column = Math.min(1, Math.floor(u)),
                row = Math.min(1, Math.floor(v));
              const fx = u - column,
                fy = v - row,
                n = base + (row * 3 + column) * 2;
              for (let axis = 0; axis < 2; axis++) {
                const top = deltas[n + axis]! * (1 - fx) + deltas[n + 2 + axis]! * fx;
                const bottom = deltas[n + 6 + axis]! * (1 - fx) + deltas[n + 8 + axis]! * fx;
                data[at + axis]! += (top * (1 - fy) + bottom * fy) * strength;
              }
            }
      }
      return output;
    },
    get stats() {
      return {
        engine: 'Rapier 2D',
        particles: cages.length * 9,
        steps: lastStep,
        cacheBytes: history.length * deltas.byteLength,
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cage of cages) cage.life.dispose();
      history.length = 0;
    },
  };
}
