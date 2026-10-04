import { compileInkMotion, type InkVertices } from '../ink/fusion/motion.js';
import { inkDetailVisibility } from '../ink/fusion/detail.js';
import { fusionText } from '../ink/fusion/text.js';
import type { FusionShape } from '../ink/fusion/shape.js';
import { bodySize, type MorphBody, type MorphFrame } from './objects.js';

import type { InkFieldFrame } from '../ink/fusion/geometry.js';

type Group = {
  sources: number[];
  targets: number[];
  from: FusionShape[];
  to: FusionShape[];
  motion: ReturnType<typeof compileInkMotion>;
  details: ReturnType<typeof inkDetailVisibility>;
  appearing: boolean;
  disappearing: boolean;
};
const text = (body: MorphBody) => String(body.text ?? '').trim();
function registered(body: MorphBody, transform: Float64Array, side: number): MorphBody {
  const at = side * 6;
  return {
    ...body,
    position: body.position.map(
      (v, axis) => v * transform[at + axis]! + transform[at + axis + 3]!,
    ) as unknown as MorphBody['position'],
    scale: [0, 1, 2].map(
      (axis) => (body.scale?.[axis] ?? 1) * transform[at + axis]!,
    ) as unknown as MorphBody['scale'],
  };
}
function surfaceMarks(frame: MorphFrame, registration: Float64Array) {
  const lines = new Map<string, { coordinates: number[]; opacity: number }>();
  for (const [parts, opacity, offset] of [
    [frame.sources, 1 - frame.morph, 0],
    [frame.targets, frame.morph, frame.sources.length],
  ] as const) {
    if (!opacity) continue;
    for (const [index, part] of parts.entries()) {
      const step = part.grid;
      if (!step) continue;
      const [w, h] = bodySize(part),
        [x, y] = part.position;
      const add = (coordinates: number[]) => {
        const at = (offset + index) * 6;
        for (let i = 0; i < 4; i += 2) {
          coordinates[i] = coordinates[i]! * registration[at]! + registration[at + 3]!;
          coordinates[i + 1] = coordinates[i + 1]! * registration[at + 1]! - registration[at + 4]!;
        }
        const key = coordinates.map((v) => Math.round(v * 1e6)).join(',');
        const previous = lines.get(key);
        if (previous) previous.opacity = Math.min(1, previous.opacity + opacity);
        else lines.set(key, { coordinates, opacity });
      };
      for (let i = step; i < w - 1e-6; i += step)
        add([x - w / 2 + i, -y - h / 2, x - w / 2 + i, -y + h / 2]);
      for (let i = step; i < h - 1e-6; i += step)
        add([x - w / 2, -y + h / 2 - i, x + w / 2, -y + h / 2 - i]);
    }
  }
  const segments = new Float32Array(lines.size * 6),
    visibility = new Float32Array(lines.size);
  let at = 0;
  for (const { coordinates, opacity } of lines.values()) {
    segments.set([...coordinates, 0.004, 0.004], at * 6);
    visibility[at++] = opacity * 0.25;
  }
  return { segments, visibility };
}
/** One correspondence and detail policy for written solids, flat forms and arithmetic. */
export function surfaceInscriptions() {
  const texts = new Map<string, FusionShape>();
  let key = '',
    groups: Group[] = [];
  function shape(body: MorphBody) {
    const value = text(body);
    let result = texts.get(value);
    if (!result) {
      result = fusionText(value, { size: 100, maxWidth: 1600, lineHeight: 1.25 });
      if (texts.size >= 96) texts.delete(texts.keys().next().value!);
      texts.set(value, result);
    }
    return result;
  }
  function pose(body: MorphBody, shape: FusionShape) {
    const size = bodySize(body);
    return {
      x: body.position[0],
      y: -body.position[1],
      scale: Math.min(
        (size[0] * 0.74) / shape.bounds.width,
        (size[1] * 0.46) / shape.bounds.height,
      ),
    };
  }
  return {
    sample(input: MorphFrame, pixel: number, registration: Float64Array): InkFieldFrame {
      const frame = {
        ...input,
        sources: input.sources.map((body, i) => registered(body, registration, i)),
        targets: input.targets.map((body, i) =>
          registered(body, registration, input.sources.length + i),
        ),
      };
      const next = JSON.stringify(
        [frame.sources, frame.targets].map((parts) => parts.map((p) => [text(p), p.origins])),
      );
      if (next !== key) {
        const indices = (parts: readonly MorphBody[]) =>
          parts.flatMap((p, i) => (text(p) ? [i] : []));
        const sources = indices(frame.sources),
          targets = indices(frame.targets);
        const local =
          frame.targets.every((p) => p.origins?.length) &&
          frame.sources.every((p) => p.origins?.length);
        const pairs = local
          ? targets.map((i) => ({
              sources: sources.filter((s) =>
                frame.sources[s]!.origins!.some((o) => frame.targets[i]!.origins!.includes(o)),
              ),
              targets: [i],
            }))
          : [];
        const assigned = pairs.flatMap((p) => p.sources);
        const mapping =
          pairs.length &&
          assigned.length === sources.length &&
          new Set(assigned).size === sources.length
            ? pairs
            : [{ sources, targets }];
        groups = mapping
          .filter((p) => p.sources.length || p.targets.length)
          .map(({ sources, targets }) => {
            const appearing = !sources.length,
              disappearing = !targets.length;
            const from = sources.map((i) => shape(frame.sources[i]!));
            const to = targets.map((i) => shape(frame.targets[i]!));
            const motion = compileInkMotion(appearing ? to : from, disappearing ? from : to);
            return {
              sources,
              targets,
              from,
              to,
              motion,
              details: inkDetailVisibility(motion.patches, true),
              appearing,
              disappearing,
            };
          });
        key = next;
      }
      const segments: InkVertices = [],
        visibility: Float32Array[] = [];
      for (const group of groups) {
        const from = group.sources.map((i, j) => pose(frame.sources[i]!, group.from[j]!));
        const to = group.targets.map((i, j) => pose(frame.targets[i]!, group.to[j]!));
        const vertices = group.motion(
          group.appearing ? to : from,
          group.disappearing ? from : to,
          frame.morph,
        );
        // Unwritten endpoints grow/absorb their own pen width without unrelated flying fragments.
        const weight = group.appearing ? frame.morph : group.disappearing ? 1 - frame.morph : 1;
        if (weight !== 1)
          for (const data of vertices)
            for (let i = 0; i < data.length; i += 6) {
              data[i + 4]! *= weight;
              data[i + 5]! *= weight;
            }
        const detail = group.details(vertices, frame.morph, pixel);
        if (weight !== 1)
          vertices.forEach((data, source) => {
            for (let i = 0; i < data.length; i += 6)
              detail[source]![i / 6]! *= Math.min(1, Math.max(data[i + 4]!, data[i + 5]!) / pixel);
          });
        segments.push(...vertices);
        visibility.push(...detail);
      }
      return {
        segments,
        visibility,
        tension:
          Math.min(...[...frame.sources, ...frame.targets].map((p) => bodySize(p)[1])) *
          0.04 *
          (1 - frame.morph) ** 2,
        details: frame.morph > 0 && frame.morph < 1,
        label: (frame.morph >= 1 ? frame.targets : frame.sources)
          .map(text)
          .filter(Boolean)
          .join(', '),
        marks: surfaceMarks(input, registration),
      };
    },
  };
}
