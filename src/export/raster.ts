import { svg } from '../ink/dom.js';

const captures = new WeakMap<SVGElement, () => string>();
/** A live GPU layer supplies an immediate snapshot when the existing SVG exporter asks. */
export function registerRaster(source: SVGElement, capture: () => string) {
  captures.set(source, capture);
  return () => captures.delete(source);
}
export function snapshotRaster(source: SVGElement, copy: SVGElement) {
  const capture = captures.get(source);
  if (!capture) return;
  const image = svg('image');
  for (const attribute of copy.attributes) image.setAttribute(attribute.name, attribute.value);
  image.setAttribute('href', capture());
  copy.replaceWith(image);
}
