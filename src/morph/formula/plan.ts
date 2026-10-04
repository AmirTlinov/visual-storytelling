import { Morph, morphPlan, bodySize, type MorphBody, type MorphObject } from '../objects.js';
import {
  volumeBox,
  volumeCapsule,
  volumeSphere,
  type VolumeShape,
} from '../../viewport/morph/field.js';
import { clamp, mathNumber, smooth, mix } from '../numbers.js';
import { partBounds } from '../measure.js';
import type { MathMorphFrame, MathMorphPlan, MathPart, MorphPoint } from '../types.js';
import { compileExpression, valuesOf, type ExpressionBody } from './expression.js';
import type { FormulaOperation } from './types.js';
import { formulaNotation, formulaValue, formulaWriting } from './notation.js';

function volume(shape: VolumeShape) {
  if (shape.kind === 'sphere') return (4 * Math.PI * shape.radius ** 3) / 3;
  if (shape.kind === 'capsule')
    return (
      Math.PI * shape.radius ** 2 * (shape.length - 2 * shape.radius) +
      (4 * Math.PI * shape.radius ** 3) / 3
    );
  const r = shape.rounding,
    [a, b, c] = shape.size.map((v) => v - 2 * r) as [number, number, number];
  return (
    a * b * c +
    2 * r * (a * b + a * c + b * c) +
    Math.PI * r ** 2 * (a + b + c) +
    (4 * Math.PI * r ** 3) / 3
  );
}
function resize(shape: VolumeShape, factor: number): VolumeShape {
  if (shape.kind === 'sphere') return volumeSphere(shape.radius * factor);
  if (shape.kind === 'capsule') return volumeCapsule(shape.radius * factor, shape.length * factor);
  return volumeBox(
    shape.size.map((v) => v * factor) as unknown as MorphPoint,
    shape.rounding * factor,
  );
}
function arrange(parts: readonly MathPart[], columns: number): MathPart[] {
  const count = Math.min(Math.max(1, columns), parts.length);
  const rows = Array.from({ length: Math.ceil(parts.length / count) }, (_, i) =>
    parts.slice(i * count, (i + 1) * count),
  );
  const gap = 0.95,
    heights = rows.map((row) => Math.max(...row.map((p) => p.size[1])));
  let y = (heights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1)) / 2;
  return rows.flatMap((row, ri) => {
    const height = heights[ri]!;
    let x = -(row.reduce((sum, p) => sum + p.size[0], 0) + gap * (row.length - 1)) / 2;
    const result = row.map((part) => {
      const placed = { ...part, position: [x + part.size[0] / 2, y - height / 2, 0] as MorphPoint };
      x += part.size[0] + gap;
      return placed;
    });
    y -= height + gap;
    return result;
  });
}
const center = (parts: readonly MathPart[]): MorphPoint => {
  const [min, max] = partBounds([...parts]);
  return min.map((v, i) => (v + max[i]!) / 2) as unknown as MorphPoint;
};
const position = (a: MorphPoint, b: MorphPoint, p: number) =>
  a.map((v, i) => mix(v, b[i]!, p)) as unknown as MorphPoint;

/** The expression compiler owns values; this planner maps data flow onto the common material. */
export function formulaPlan(operation: FormulaOperation): MathMorphPlan {
  const expression = compileExpression(operation);
  const amounts = [
    ...expression.initial.map((p) => p.value),
    ...expression.steps.flatMap((step) => valuesOf(step.value)),
  ];
  const positive = amounts.every((v) => v > 0);
  const measure =
    operation.measure === 'volume' ||
    (operation.measure !== 'value' && positive && Math.max(...amounts) / Math.min(...amounts) <= 64)
      ? 'volume'
      : 'value';
  if (measure === 'volume' && !positive)
    throw new Error(
      'Volume measures positive amounts; use measure: "value" for signed values and zero',
    );
  const object = (entry: ExpressionBody): MathPart => {
    const template = entry.body ?? Morph.box([1.4, 1.4, 1.4]);
    const factor = Math.cbrt(
      ((measure === 'volume' ? entry.value : 1) * 1.4 ** 3) / volume(template.shape),
    );
    const shape = resize(template.shape, factor);
    return {
      id: entry.id,
      value: entry.value,
      origins: entry.origins,
      shape,
      size: bodySize({ shape, position: [0, 0, 0] }),
      position: [0, 0, 0],
    };
  };
  type Stage = { sample(p: number, duration: number): Omit<MathMorphFrame, 'stage'> };
  const layouts = new Map<number, { stages: Stage[]; bounds: [MorphPoint, MorphPoint] }>();
  function layout(columns: number) {
    columns = Math.max(1, Math.min(64, Math.floor(columns)));
    const cached = layouts.get(columns);
    if (cached) return cached;
    let current = arrange(expression.initial.map(object), columns);
    const extents = [...current],
      stages: Stage[] = [];
    for (const step of expression.steps) {
      const formula = [false, true].map((resolved) => formulaNotation(step, resolved));
      const ids = new Set(step.inputs.map((p) => p.id));
      const inputs = step.inputs.map((input) => current.find((p) => p.id === input.id)!);
      const first = current.findIndex((p) => ids.has(p.id!));
      const remaining = current.filter((p) => !ids.has(p.id!));
      const outputs = step.outputs.map(object);
      const next = arrange(
        [...remaining.slice(0, first), ...outputs, ...remaining.slice(first)],
        columns,
      );
      const targets = outputs.map((output) => next.find((p) => p.id === output.id)!);
      const passive = remaining.map((part) => ({
        from: part,
        to: next.find((p) => p.id === part.id)!,
      }));
      // Balanced groups generalize scalar, tensor and shape-changing functions.
      // Every source belongs to exactly one group; no duplicated ghost surfaces.
      const count = Math.min(inputs.length, targets.length);
      const groups = Array.from({ length: count }, (_, index) => {
        const from = inputs.slice(
          Math.floor((index * inputs.length) / count),
          Math.floor(((index + 1) * inputs.length) / count),
        );
        const to = targets.slice(
          Math.floor((index * targets.length) / count),
          Math.floor(((index + 1) * targets.length) / count),
        );
        const asObject = (p: MathPart): MorphObject => ({
          shape: p.shape!,
          text: mathNumber(p.value),
        });
        const operation =
          from.length === 1 && to.length === 1
            ? Morph.transform(asObject(from[0]!), asObject(to[0]!))
            : from.length === 1
              ? Morph.split(asObject(from[0]!), to.map(asObject))
              : Morph.merge(from.map(asObject), asObject(to[0]!));
        const plan = morphPlan(operation, { columns });
        const reverse = operation.kind === 'split';
        const sample = plan.sample;
        const start = sample(0),
          end = sample(1);
        const sourceData = reverse ? to : from,
          targetData = reverse ? from : to;
        const fromCenter = center(from),
          toCenter = center(to);
        const correction = [0, 1, 2].map((axis) =>
          Math.max(
            ...sourceData.map((part, i) =>
              Math.abs(
                part.position[axis]! -
                  (reverse ? toCenter : fromCenter)[axis]! -
                  (reverse ? end : start).sources[i]!.position[axis]!,
              ),
            ),
            ...targetData.map((part, i) =>
              Math.abs(
                part.position[axis]! -
                  (reverse ? fromCenter : toCenter)[axis]! -
                  (reverse ? start : end).targets[i]!.position[axis]!,
              ),
            ),
          ),
        );
        const low = plan.bounds[0].map(
          (v, axis) => v + Math.min(fromCenter[axis]!, toCenter[axis]!) - correction[axis]!,
        );
        const high = plan.bounds[1].map(
          (v, axis) => v + Math.max(fromCenter[axis]!, toCenter[axis]!) + correction[axis]!,
        );
        extents.push({
          value: 0,
          position: low.map((v, i) => (v + high[i]!) / 2) as unknown as MorphPoint,
          size: low.map((v, i) => high[i]! - v) as unknown as MorphPoint,
        });
        const move = (
          body: MorphBody,
          data: MathPart,
          canonical: MorphBody,
          origin: MorphPoint,
          at: MorphPoint,
          weight: number,
        ): MathPart => {
          const point = body.position.map(
            (v, axis) =>
              v +
              at[axis]! +
              (data.position[axis]! - origin[axis]! - canonical.position[axis]!) * weight,
          ) as unknown as MorphPoint;
          return {
            ...data,
            shape: body.shape,
            scale: body.scale,
            rounding: body.rounding,
            size: bodySize(body),
            position: point,
            material: `${step.id}:${index}`,
          };
        };
        return {
          contacts: Math.max(from.length, to.length),
          sample(p: number, duration: number) {
            const frame = sample(p, duration),
              at = position(fromCenter, toCenter, smooth(p));
            const incoming = 1 - smooth(p / 0.2),
              outgoing = smooth((p - 0.8) / 0.2);
            return {
              material: `${step.id}:${index}`,
              morph: frame.morph,
              tension: frame.tension,
              sources: frame.sources.map((body, i) =>
                move(
                  body,
                  sourceData[i]!,
                  (reverse ? end : start).sources[i]!,
                  reverse ? toCenter : fromCenter,
                  at,
                  reverse ? outgoing : incoming,
                ),
              ),
              targets: frame.targets.map((body, i) =>
                move(
                  body,
                  targetData[i]!,
                  (reverse ? start : end).targets[i]!,
                  reverse ? fromCenter : toCenter,
                  at,
                  reverse ? incoming : outgoing,
                ),
              ),
            };
          },
        };
      });
      stages.push({
        sample(p, duration) {
          const motion = clamp(p / 0.9);
          const frames = groups.map((group) => group.sample(motion, duration * 0.9));
          const clock = groups.findIndex((group) => group.contacts > 1);
          const clockFrame = frames[Math.max(0, clock)]!;
          const still = passive.map(({ from, to }) => ({
            ...from,
            position: position(from.position, to.position, smooth(motion)),
            material: `passive:${from.id}`,
          }));
          return {
            sources: [...frames.flatMap((f) => f.sources), ...still],
            targets: [...frames.flatMap((f) => f.targets), ...still],
            materials: Object.fromEntries([
              ...frames.map(
                ({ material, morph, tension }) => [material, { morph, tension }] as const,
              ),
              ...still.map((part) => [part.material, { morph: 0, tension: 0 }] as const),
            ]),
            morph: clockFrame.morph,
            tension: Math.max(...frames.map((f) => f.tension ?? 0)),
            formula: formula[Number(p >= 0.9)]!,
            phase: p >= 0.9 ? 'hold' : clockFrame.morph === 0 ? 'approach' : 'contact',
            result: p >= 0.9 ? step.value : undefined,
          };
        },
      });
      current = next;
      extents.push(...current);
    }
    if (!stages.length)
      stages.push({
        sample: () => ({
          sources: current,
          targets: current,
          morph: 0,
          phase: 'hold',
          result: expression.result,
          formula: `${formulaWriting(operation.expression)} = ${formulaValue(expression.result)}`,
        }),
      });
    const bounds = partBounds(extents);
    const result = { stages, bounds };
    // Keep only the few actual responsive arrangements, not every resize pixel.
    if (layouts.size >= 8) layouts.delete(layouts.keys().next().value!);
    layouts.set(columns, result);
    return result;
  }
  const initial = layout(4);
  return {
    encoding: 'objects',
    measure,
    result: expression.result,
    stages: initial.stages.length,
    bounds: initial.bounds,
    boundsFor: (columns) => layout(columns).bounds,
    sample(progress, options) {
      if (!Number.isFinite(progress)) throw new Error('Morph progress must be finite');
      const duration = options?.duration ?? 3.4;
      if (!Number.isFinite(duration) || duration < 0)
        throw new Error('Morph duration must be finite and non-negative');
      const p = clamp(progress),
        arranged = layout(options?.columns ?? 4);
      const stage = Math.min(arranged.stages.length - 1, Math.floor(p * arranged.stages.length));
      return {
        ...arranged.stages[stage]!.sample(
          p === 1 ? 1 : p * arranged.stages.length - stage,
          duration,
        ),
        stage,
      };
    },
  };
}
