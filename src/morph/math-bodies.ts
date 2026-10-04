import { volumeBox } from '../viewport/morph/field.js';
import { mathNumber } from './numbers.js';
import type { MathMorphFrame, MathPart } from './types.js';
import type { MorphFrame } from './objects.js';
import { quantityStep } from './measure.js';

/** Arithmetic owns values and lineage; the shared body owns every visible stroke. */
export function mathBodies(frame: MathMorphFrame, measured: boolean): MorphFrame {
  const body = (part: MathPart) => ({
    // Authored dimensions belong to the material. A pose scale is reserved for
    // deformation, so local measurement marks deform with their body as well.
    shape: part.shape ?? volumeBox(part.size),
    scale: part.scale,
    rounding: part.rounding,
    material: part.material,
    text: mathNumber(part.value),
    position: part.position,
    origins: part.origins?.map((o) => `${o.operand}:${o.index}`),
    grid: measured ? quantityStep(part) : undefined,
  });
  return {
    sources: frame.sources.map(body),
    targets: frame.targets.map(body),
    morph: frame.morph,
    tension: frame.tension ?? 0,
    materials: frame.materials,
  };
}
