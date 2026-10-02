import { SketchMotion } from './motion.js';
/** The same pen movement is used by shape reveals and handwritten labels. */
export function strokes(root: SVGElement | SVGPathElement[]) {
  const paths = Array.isArray(root)
    ? root
    : [...root.querySelectorAll<SVGPathElement>('path')].filter((path) => !path.closest('defs'));
  return (progress: number) => SketchMotion.trace(paths, progress);
}
