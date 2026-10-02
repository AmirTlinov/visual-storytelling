import { object } from '../ink/object.js';
import { svg, clamp } from '../ink/dom.js';
import type { Surface } from '../ink/surface.js';
import type { Pigment } from '../ink/palette.js';

/** The filled area encodes quantity; the pigment stays constant. */
export function portion(
  view: Surface,
  id: string,
  options: {
    x: number;
    y: number;
    size: number;
    pigment: Pigment;
  },
) {
  const mark = object(view.layer, id, options.pigment);
  mark.at(options.x, options.y);
  const { size } = options;
  const fill = view.pen.rect(mark.content, `${id}:wash`, -size / 2, 0, size, size, {
    fill: 'marker',
    width: 0,
  });
  const defs = svg('defs'),
    clipId = `${view.element.id}-${id}-quantity`;
  const clip = svg('clipPath', { id: clipId });
  const window = svg('rect', { x: -size / 2 - 1, y: 0, width: size + 2, height: size });
  clip.append(window);
  defs.append(clip);
  mark.content.append(defs);
  fill.element.setAttribute('clip-path', `url(#${clipId})`);
  view.pen.rect(mark.content, `${id}:outline`, -size / 2, 0, size, size, { width: 1.4 });
  return {
    ...mark,
    set(fraction: number) {
      const p = clamp(fraction);
      window.setAttribute('y', String(size * (1 - p)));
      window.setAttribute('height', String(size * p));
      mark.element.dataset.fraction = String(p);
    },
  };
}
