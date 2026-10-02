import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { Pigment } from '../ink/palette.js';

/** A base and its indices remain one object for layout, motion and colour. */
export function symbol(
  parent: SVGElement,
  id: string,
  value: string,
  options: {
    x: number;
    y: number;
    size?: number;
    sub?: string;
    sup?: string;
    pigment?: Pigment;
  },
) {
  const mark = object(parent, id, options.pigment);
  const size = options.size ?? 25;
  const base = lettering(mark.content, value, { size, anchor: 'start', tabular: true });
  const indexSize = size * 0.62;
  const scripts = [
    options.sub
      ? lettering(mark.content, options.sub, {
          x: base.width + 1,
          y: size * 0.27,
          size: indexSize,
          anchor: 'start',
        })
      : undefined,
    options.sup
      ? lettering(mark.content, options.sup, {
          x: base.width + 1,
          y: -size * 0.48,
          size: indexSize,
          anchor: 'start',
        })
      : undefined,
  ];
  const width = base.width + Math.max(0, ...scripts.map((label) => label?.width ?? 0));
  mark.at(options.x - width / 2, options.y);
  return { ...mark, width };
}
