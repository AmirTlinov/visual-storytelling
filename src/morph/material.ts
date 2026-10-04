import { volumeField, type VolumePoint } from '../viewport/morph/field.js';
import { dampedSpring } from '../physics/spring.js';
import { physicalMaterials } from '../physics/materials.js';
import { bodySize, type MorphBody, type MorphFrame } from './objects.js';

// One material law for every authored shape. Geometry supplies contact, strain
// and release; no operation-specific pulse or animation phase drives the spring.
const restitution = physicalMaterials.solid.restitution;
const loss = -Math.log(restitution);
const dampingRatio = loss / Math.hypot(Math.PI, loss);
const compliance = 0.1,
  strainLimit = 0.018;

function deform(frame: MorphFrame, strain: readonly number[]): MorphFrame {
  if (strain.every((value) => Math.abs(value) < 1e-10)) return frame;
  const bounded = strain.map((value) => strainLimit * Math.tanh(value / strainLimit));
  const mean = bounded.reduce((sum, value) => sum + value, 0) / 3;
  // Deviatoric strain: the spring deforms material without pumping its volume.
  const stretch = bounded.map((value) => Math.exp(value - mean));
  const pose = (body: MorphBody): MorphBody => ({
    ...body,
    position: body.position.map((value, axis) => value * stretch[axis]!) as unknown as VolumePoint,
    scale: stretch.map(
      (value, axis) => value * (body.scale?.[axis] ?? 1),
    ) as unknown as VolumePoint,
  });
  return { ...frame, sources: frame.sources.map(pose), targets: frame.targets.map(pose) };
}

/** Compile a causal elastic response once. Only the operation clock is sampled
 * during playback; arbitrary seeks cannot inject new impulses or lose energy. */
export function materialMotion(shapeAt: (progress: number) => MorphFrame, duration: number) {
  if (!Number.isFinite(duration) || duration < 0)
    throw new Error('Morph duration must be finite and non-negative');
  if (duration === 0) return shapeAt;
  const spring = dampedSpring(
    Math.max(3.2, -Math.log(0.001) / (2 * Math.PI * dampingRatio * duration * 0.22)),
    dampingRatio,
  );
  const start = shapeAt(0);
  const field = volumeField(
    start.sources.map((p) => p.shape),
    start.targets.map((p) => p.shape),
  );
  // The clock reserves the material's own decay time for settling, bounded for
  // very short gestures. The geometric action therefore finishes before the hold.
  const active = 1 - Math.min(0.22, spring.settlingTime / duration);
  const steps = Math.max(240, Math.min(2048, Math.ceil(duration * 120))),
    dt = duration / steps;
  const history = new Float64Array((steps + 1) * 3);
  let strain = [0, 0, 0],
    velocity = [0, 0, 0],
    previousSize: number[] | undefined,
    previousRate = [0, 0, 0],
    equilibrium = [0, 0, 0],
    previousGaps: number[] = [],
    closingRates: number[] = [];
  for (let tick = 0; tick <= steps; tick++) {
    // Integrate only the load known at the start of this interval. Recording
    // after a newly observed collision would interpolate its impulse backwards
    // into the still rigid approach between the previous and current sample.
    if (tick) {
      for (let axis = 0; axis < 3; axis++)
        [strain[axis], velocity[axis]] = spring.step(
          strain[axis]!,
          velocity[axis]!,
          equilibrium[axis]!,
          dt,
        );
      history.set(strain, tick * 3);
    }
    const frame = shapeAt(Math.min(1, tick / steps / active));
    field.update(frame);
    const sources = frame.sources.map(bodySize),
      targets = frame.targets.map(bodySize);
    const packed = (sizes: readonly VolumePoint[], axis: number) =>
      axis === 0
        ? sizes.reduce((sum, size) => sum + size[axis], 0)
        : Math.max(...sizes.map((s) => s[axis]!));
    const size = [0, 1, 2].map(
      (axis) =>
        Math.log(packed(sources, axis) * field.registration[axis]!) * (1 - frame.morph) +
        Math.log(packed(targets, axis) * field.registration[frame.sources.length * 6 + axis]!) *
          frame.morph,
    );
    const rate = size.map((value, axis) => (previousSize ? (value - previousSize[axis]!) / dt : 0));
    let traction = 0;
    const gaps: number[] = [];
    for (let i = 0; i < frame.sources.length - 1; i++) {
      const a = frame.sources[i]!,
        b = frame.sources[i + 1]!;
      const width = (sources[i]![0] + sources[i + 1]![0]) / 2;
      const separation = b.position[0] - a.position[0] - width;
      const gap = separation > Number.EPSILON * width * 8 ? separation : 0;
      gaps.push(gap);
      // Contact reaction follows the actual closing velocity. No approach load
      // exists while the two source surfaces remain separated.
      if (gap === 0 && (previousGaps[i] ?? 0) > 0)
        velocity[0]! -= Math.max(0, closingRates[i] ?? 0) / width / (frame.sources.length - 1);
      closingRates[i] = ((previousGaps[i] ?? gap) - gap) / dt;
      const seam =
        (a.position[0] + sources[i]![0] / 2 + b.position[0] - sources[i + 1]![0] / 2) / 2;
      const x = seam * field.registration[0]! + field.registration[3]!;
      if (gap === 0 || field.distance(x, 0, 0) >= 0) continue;
      // The shrinking neck's measured cross-section carries tensile load.
      // The same section rule covers boxes, balls and capsules.
      const radii = [1, 2].map((axis) => {
        let low = 0,
          high = field.bounds.max.getComponent(axis);
        for (let n = 0; n < 10; n++) {
          const middle = (low + high) / 2;
          if (field.distance(x, axis === 1 ? middle : 0, axis === 2 ? middle : 0) < 0) low = middle;
          else high = middle;
        }
        return (low + high) / 2;
      });
      const faceArea =
        Math.min(sources[i]![1] * sources[i]![2], sources[i + 1]![1] * sources[i + 1]![2]) *
        field.registration[1]! *
        field.registration[2]!;
      const neck = Math.min(1, (4 * radii[0]! * radii[1]!) / faceArea);
      traction += (((compliance * gap) / width) * neck) / (frame.sources.length - 1);
    }
    for (let axis = 0; axis < 3; axis++) {
      const acceleration = (rate[axis]! - previousRate[axis]!) / dt;
      equilibrium[axis] = (axis === 0 ? traction : 0) - acceleration / spring.stiffness;
    }
    previousGaps = gaps;
    previousSize = size;
    previousRate = rate;
  }
  return (progress: number) => {
    if (!Number.isFinite(progress)) throw new Error('Morph progress must be finite');
    const p = Math.max(0, Math.min(1, progress));
    const frame = shapeAt(Math.min(1, p / active));
    if (p === 0 || p === 1) return frame;
    const tick = p * steps,
      low = Math.floor(tick),
      fraction = tick - low;
    return deform(
      frame,
      [0, 1, 2].map(
        (axis) =>
          history[low * 3 + axis]! * (1 - fraction) + history[(low + 1) * 3 + axis]! * fraction,
      ),
    );
  };
}
