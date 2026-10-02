import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { Pigment } from '../ink/palette.js';
import type { Surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import { interpolate } from '../story/cues.js';

export function token(
  view: Surface,
  id: string,
  value: string | number,
  options: { size?: number; width?: number; pigment?: Pigment } = {},
) {
  const mark = object(view.layer, id, options.pigment ?? 'blue');
  const size = options.size ?? 44;
  const width = options.width ?? size;
  const shape = view.pen.rect(mark.content, `${id}:shape`, -width / 2, -size / 2, width, size, {
    fill: 'marker',
  });
  const label = lettering(mark.content, value, { y: size * 0.17, size: size * 0.58 });
  const wash = shape.element.querySelector<SVGGElement>('.ve-marker')!;
  return {
    ...mark,
    label,
    highlight(active: boolean) {
      wash.style.display = active ? '' : 'none';
    },
    reveal(p: number) {
      shape.reveal(p);
      label.write(p);
    },
  };
}

/** Index identity is retained while positions interpolate between complete arrangements. */
export function regroup(from: readonly Point[], to: readonly Point[], progress: number): Point[] {
  if (from.length !== to.length) throw new Error('Regrouping must preserve the number of objects');
  return from.map((point, i) => [
    interpolate(point[0], to[i]![0], progress),
    interpolate(point[1], to[i]![1], progress),
  ]);
}

/** Two identities travel in separate arcs, so crossing does not obscure the values. */
export function swap(from: Point, to: Point, progress: number, lift = 36): readonly [Point, Point] {
  const p = Math.max(0, Math.min(1, progress));
  if (p === 0) return [from, to];
  if (p === 1) return [to, from];
  const arc = Math.sin(Math.PI * p) * lift;
  return [
    [interpolate(from[0], to[0], p), interpolate(from[1], to[1], p) - arc],
    [interpolate(to[0], from[0], p), interpolate(to[1], from[1], p) + arc],
  ];
}
