import { svg } from '../ink/dom.js';

const captures = new WeakMap<SVGElement | HTMLCanvasElement, () => string>();
/** A live GPU layer supplies an immediate snapshot when the existing SVG exporter asks. */
export function registerRaster(source: SVGElement | HTMLCanvasElement, capture: () => string) {
  captures.set(source, capture);
  return () => captures.delete(source);
}
/** WebGL buffers may be discarded after presentation; their viewport owns the redraw. */
export async function snapshotCanvas(source: HTMLCanvasElement, copy: HTMLCanvasElement) {
  copy.width = source.width;
  copy.height = source.height;
  const capture = captures.get(source);
  if (!capture) {
    copy.getContext('2d')!.drawImage(source, 0, 0);
    return;
  }
  const image = new Image();
  image.src = capture();
  await image.decode();
  copy.getContext('2d')!.drawImage(image, 0, 0);
}
export function snapshotRaster(source: SVGElement, copy: SVGElement) {
  const capture = captures.get(source);
  if (!capture) return;
  const image = svg('image');
  for (const attribute of copy.attributes) image.setAttribute(attribute.name, attribute.value);
  image.setAttribute('href', capture());
  copy.replaceWith(image);
}
