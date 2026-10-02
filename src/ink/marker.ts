import { svg } from './dom.js';
import { SketchInk } from './marks.js';
export function marker(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  seed: number,
) {
  const element = svg('g');
  element.innerHTML =
    SketchInk.markerDefs(id) +
    SketchInk.markerMarkup({
      x,
      y,
      width,
      height,
      seed,
      prefix: id,
      color: 'color-mix(in srgb,currentColor var(--ve-wash-strength,18%),transparent)',
    });
  return element;
}
