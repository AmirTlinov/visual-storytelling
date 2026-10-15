import { Box3, Vector3 } from 'three';
import type { MathMorphPlan, MathMorphFrame } from './types.js';
import type { cellLayout } from './layout.js';
const clamp = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => {
  const p = clamp(n);
  return p * p * (3 - 2 * p);
};
const envelopes = new WeakMap<MathMorphPlan, Map<string, readonly Box3[]>>();
/** A completed calculation settles before handing its result to a receiving cell. */
export function calculationTiming(progress: number, delivery: boolean) {
  if (!Number.isFinite(progress)) throw new Error('Calculation progress must be finite.');
  const p = clamp(progress);
  return {
    calculation: delivery ? clamp(p / 0.82) : p,
    delivery: delivery ? clamp((p - 0.84) / 0.16) : undefined,
    framing: delivery ? clamp((p - 0.82) / 0.02) : 0,
  };
}
/** Fixed cells use stage framing; deforming bodies retain their analytic complete envelope. */
export function calculationFraming(
  plan: MathMorphPlan,
  frame: MathMorphFrame,
  progress: number,
  options: {
    annotationHeight?: number;
    /** Pass the drawing owner's arrangement; framing never chooses columns. */
    arrangement?: Pick<ReturnType<typeof cellLayout>, 'columns' | 'bounds'>;
    delivery?: { bounds: Box3; progress: number };
    reduced?: boolean;
  } = {},
) {
  const height = options.annotationHeight ?? 0,
    columns = options.arrangement?.columns;
  const key = JSON.stringify([height, columns, options.arrangement?.bounds]);
  if (!Number.isFinite(progress) || !Number.isFinite(height) || height < 0)
    throw new Error(
      'Calculation framing needs finite progress and a non-negative annotation height.',
    );
  if (!Number.isSafeInteger(frame.stage) || frame.stage < 0 || frame.stage >= plan.stages)
    throw new Error('Calculation frame stage is outside its plan.');
  if (options.delivery && !Number.isFinite(options.delivery.progress))
    throw new Error('Delivery framing progress must be finite.');
  let layouts = envelopes.get(plan);
  if (!layouts) {
    layouts = new Map();
    envelopes.set(plan, layouts);
  }
  let stages = layouts.get(key);
  if (!stages) {
    stages = Array.from({ length: plan.stages }, (_, stage) => {
      if (plan.encoding !== 'cells') {
        const bounds = new Box3(
          new Vector3(...(options.arrangement?.bounds ?? plan.bounds)[0]),
          new Vector3(...(options.arrangement?.bounds ?? plan.bounds)[1]),
        );
        bounds.max.y += height;
        return bounds;
      }
      const bounds = new Box3(),
        sample = plan.sample(stage / plan.stages, { columns });
      for (const part of [...sample.sources, ...sample.targets])
        bounds.union(
          new Box3().setFromCenterAndSize(
            new Vector3(...part.position),
            new Vector3(...part.size).multiply(new Vector3(...(part.scale ?? [1, 1, 1]))),
          ),
        );
      bounds.max.y += height;
      return bounds;
    });
    layouts.set(key, stages);
    if (layouts.size > 8) layouts.delete(layouts.keys().next().value!);
  }
  const bounds = stages[frame.stage]!.clone(),
    local = Math.min(1, clamp(progress) * plan.stages - frame.stage);
  if (frame.stage + 1 < stages.length && local > 0.9) {
    const next = stages[frame.stage + 1]!,
      amount = options.reduced ? 1 : smooth((local - 0.9) / 0.1);
    bounds.min.lerp(next.min, amount);
    bounds.max.lerp(next.max, amount);
  }
  if (options.delivery) {
    const amount = options.reduced
      ? Number(options.delivery.progress > 0)
      : smooth(options.delivery.progress);
    bounds.min.lerp(options.delivery.bounds.min, amount);
    bounds.max.lerp(options.delivery.bounds.max, amount);
  }
  return bounds;
}
