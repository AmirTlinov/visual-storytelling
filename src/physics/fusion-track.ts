import R from '@dimforge/rapier2d-compat';
import type { FusionFrame } from '../ink/fusion/surface.js';
import {
  inkGather,
  type inkMotion,
  type InkPatch,
  type InkVertices,
} from '../ink/fusion/motion.js';
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

function displacement(
  data: Float32Array,
  base: number,
  box: Float64Array,
  x: number,
  y: number,
  axis: number,
) {
  const u = Math.max(0, Math.min(2, (x - box[0]!) / box[2]! + 1)),
    v = Math.max(0, Math.min(2, (y - box[1]!) / box[3]! + 1));
  const column = Math.min(1, Math.floor(u)),
    row = Math.min(1, Math.floor(v));
  const fx = u - column,
    fy = v - row,
    n = base + (row * 3 + column) * 2 + axis;
  const top = data[n]! * (1 - fx) + data[n + 2]! * fx,
    bottom = data[n + 6]! * (1 - fx) + data[n + 8]! * fx;
  return top * (1 - fy) + bottom * fy;
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
  const merged = new Map<number, { box: Float64Array; offsets: Float32Array; count: number }>();
  const output: InkVertices = [
    new Float32Array(initial[0].length),
    new Float32Array(initial[1].length),
  ];
  const cages = motion.patches.map((patch, index) => {
    if (!merged.has(patch.target))
      merged.set(patch.target, {
        box: new Float64Array(4),
        offsets: new Float32Array(18),
        count: 0,
      });
    const shared = merged.get(patch.target)!;
    shared.count++;
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
    return { patch, box, body, rest, nodes, life, shared, limit: box[3]! * 0.4, target: center };
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
      // Joining ink acquires one deformation field. Independent cages must never
      // pull coincident strokes apart again after their geometric correspondence has merged.
      const separate = (1 - inkGather(morph)) ** 2;
      for (const shared of merged.values()) {
        shared.offsets.fill(0);
        shared.box[0] = shared.box[1] = Infinity;
        shared.box[2] = shared.box[3] = -Infinity;
      }
      cages.forEach((cage, j) => {
        bounds(geometry, cage.patch, cage.box);
        const box = cage.shared.box;
        box[0] = Math.min(box[0]!, cage.box[0]! - cage.box[2]!);
        box[1] = Math.min(box[1]!, cage.box[1]! - cage.box[3]!);
        box[2] = Math.max(box[2]!, cage.box[0]! + cage.box[2]!);
        box[3] = Math.max(box[3]!, cage.box[1]! + cage.box[3]!);
        for (let n = 0; n < 18; n++)
          cage.shared.offsets[n]! += deltas[j * 18 + n]! / cage.shared.count;
      });
      for (const { box } of merged.values()) {
        const x = (box[0]! + box[2]!) / 2,
          y = (box[1]! + box[3]!) / 2;
        box[2] = (box[2]! - box[0]!) / 2;
        box[3] = (box[3]! - box[1]!) / 2;
        box[0] = x;
        box[1] = y;
      }
      for (let j = 0; j < cages.length; j++) {
        const cage = cages[j]!;
        const data = output[cage.patch.source],
          base = j * 18;
        for (const [offset, length] of cage.patch.ranges)
          for (let i = offset; i < offset + length; i += 6)
            for (let end = 0; end < 4; end += 2) {
              const at = i + end;
              const x = data[at]!,
                y = data[at + 1]!;
              for (let axis = 0; axis < 2; axis++) {
                const own = displacement(deltas, base, cage.box, x, y, axis);
                const shared = displacement(cage.shared.offsets, 0, cage.shared.box, x, y, axis);
                data[at + axis]! += (own * separate + shared * (1 - separate)) * strength;
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
