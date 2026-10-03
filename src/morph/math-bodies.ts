import { volumeBox } from '../viewport/morph/field.js';
import { mathNumber } from './numbers.js';
import type { MathMorphFrame, MathPart } from './types.js';
import type { MorphFrame } from './objects.js';
import { quantityStep } from './measure.js';

const box = volumeBox([1, 1, 1]);
/** Arithmetic owns values and lineage; the shared body owns every visible stroke. */
export function mathBodies(frame: MathMorphFrame, measured: boolean): MorphFrame {
  const body = (part: MathPart) => ({
    shape: box,
    text: mathNumber(part.value),
    position: part.position,
    scale: part.size,
    origins: part.origins?.map((o) => `${o.operand}:${o.index}`),
    grid: measured ? quantityStep(part) : undefined,
  });
  return {
    sources: frame.sources.map(body),
    targets: frame.targets.map(body),
    morph: frame.morph,
    tension: frame.tension ?? 0,
  };
}
