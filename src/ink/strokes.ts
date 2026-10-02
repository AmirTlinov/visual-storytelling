import { clamp } from './dom.js';

/** Geometry is measured once; seeking changes only the visible stroke length. */
export function strokes(root: SVGElement | SVGPathElement[]) {
  const paths = Array.isArray(root)
    ? root
    : [...root.querySelectorAll<SVGPathElement>('path')].filter((path) => !path.closest('defs'));
  const lengths = paths.map((path) => path.getTotalLength());
  const total = lengths.reduce((sum, length) => sum + length, 0);
  let previous = -1;
  return (progress: number) => {
    const p = clamp(progress);
    if (p === previous) return;
    previous = p;
    let remaining = total * p;
    paths.forEach((path, i) => {
      const length = lengths[i]!;
      path.style.visibility = remaining > 0 ? 'visible' : 'hidden';
      path.style.strokeDasharray = p === 1 ? '' : `${length} ${length}`;
      path.style.strokeDashoffset = p === 1 ? '' : String(Math.max(0, length - remaining));
      remaining -= length;
    });
  };
}
