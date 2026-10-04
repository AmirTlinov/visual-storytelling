import { compileInkMotion, type InkVertices } from '../ink/fusion/motion.js';
import { inkDetailVisibility } from '../ink/fusion/detail.js';
import { fusionText } from '../ink/fusion/text.js';
import type { FusionShape } from '../ink/fusion/shape.js';
import { bodySize, shapeSize, type MorphBody, type MorphFrame } from './objects.js';

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
const numeric = (value: string) => /^[+\-−]?\d[\d\s.,]*(?:[eE][+\-]?\d+)?%?$/.test(value);
function writingArea(body: MorphBody, rest = false): readonly [number, number] {
  const size = rest ? shapeSize(body.shape) : bodySize(body);
  const radius =
    body.shape.kind === 'box'
      ? rest
        ? body.shape.rounding
        : (body.rounding ?? body.shape.rounding)
      : body.shape.radius;
  // Curved end caps turn away from the reader. Keep the writing on their
  // front patch instead of letting the last letters run onto the silhouette.
  return [size[0] * 0.74 - radius * (rest ? 1 : (body.scale?.[0] ?? 1)) * 0.3, size[1] * 0.46];
}
function layoutKey(body: MorphBody) {
  const value = text(body),
    [width, height] = writingArea(body, true);
  return JSON.stringify([value, numeric(value) ? 0 : width / height]);
}
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
      const [w, h] = shapeSize(part.shape),
        [sx, sy] = part.scale ?? [1, 1, 1],
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
        add([x + (-w / 2 + i) * sx, -y - (h / 2) * sy, x + (-w / 2 + i) * sx, -y + (h / 2) * sy]);
      for (let i = step; i < h - 1e-6; i += step)
        add([x - (w / 2) * sx, -y + (h / 2 - i) * sy, x + (w / 2) * sx, -y + (h / 2 - i) * sy]);
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
    const [width, height] = writingArea(body, true),
      aspect = width / height,
      id = layoutKey(body);
    let result = texts.get(id);
    if (!result) {
      result = fusionText(value, { size: 100, maxWidth: 1e6, lineHeight: 1.25 });
      // Layout belongs to the authored surface, not its animated scale or the
      // camera. Choose it once; the same strokes then travel through every seek.
      if (!numeric(value)) {
        let fit = Math.min(aspect / result.bounds.width, 1 / result.bounds.height);
        const unwrappedWidth = result.width,
          balanced = Math.sqrt(unwrappedWidth * 125 * aspect),
          narrowest = Math.min(unwrappedWidth, Math.max(60, balanced * 0.55));
        // Search through the full line width: on a tall surface the longest
        // intact word can be much wider than the ideally balanced block.
        for (let i = 0; narrowest < unwrappedWidth && i < 12; i++) {
          const maxWidth = narrowest * (unwrappedWidth / narrowest) ** (i / 11);
          const candidate = fusionText(value, { size: 100, maxWidth, lineHeight: 1.25 });
          // A larger font does not justify turning an ordinary word into
          // fragments. Every caption has a valid whole-word baseline above.
          if (
            candidate.text!.words.some(
              (word) => new Set(word.glyphs.map((i) => candidate.text!.glyphs[i]!.line)).size > 1,
            )
          )
            continue;
          const scale = Math.min(aspect / candidate.bounds.width, 1 / candidate.bounds.height);
          if (scale > fit) {
            result = candidate;
            fit = scale;
          }
        }
      }
      if (texts.size >= 96) texts.delete(texts.keys().next().value!);
      texts.set(id, result);
    }
    return result;
  }
  function pose(body: MorphBody, shape: FusionShape) {
    const [width, height] = writingArea(body);
    return {
      x: body.position[0],
      y: -body.position[1],
      scale: Math.min(width / shape.bounds.width, height / shape.bounds.height),
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
        [input.sources, input.targets].map((parts) =>
          parts.map((p) => [text(p) ? layoutKey(p) : '', p.origins]),
        ),
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
            const from = sources.map((i) => shape(input.sources[i]!));
            const to = targets.map((i) => shape(input.targets[i]!));
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
