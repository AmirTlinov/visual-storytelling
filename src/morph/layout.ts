import { partBounds } from './measure.js';
import type { MathMorphPlan } from './types.js';

/** Publish intrinsic composition height to the shared scene CSS, without fixed scene wrappers. */
export function cellViewport(host: HTMLElement) {
  const previous = host.getAttribute('data-math-layout');
  const height = host.style.getPropertyValue('--ve-math-height');
  const restore = () => {
    if (previous === null) host.removeAttribute('data-math-layout');
    else host.setAttribute('data-math-layout', previous);
    if (height) host.style.setProperty('--ve-math-height', height);
    else host.style.removeProperty('--ve-math-height');
  };
  return {
    resize(height?: number) {
      if (height === undefined) return restore();
      host.setAttribute('data-math-layout', 'cells');
      host.style.setProperty('--ve-math-height', `${height}px`);
    },
    dispose: restore,
  };
}

/** Reserve one readable composition for the operation, including its intermediate steps. */
export function cellLayout(plan: MathMorphPlan, width: number) {
  const columns = Math.max(1, Math.floor((width - 24) / 140));
  const parts = [];
  for (let stage = 0; stage < plan.stages; stage++) {
    const frame = plan.sample(stage / plan.stages, { columns });
    parts.push(...frame.sources, ...frame.targets);
    for (const note of frame.notes ?? [])
      if (!note.id.startsWith('operator:'))
        parts.push({
          position: note.position,
          size: [note.size[0], note.size[1], 1] as const,
          value: 0,
        });
  }
  const [min, max] = partBounds(parts);
  const scale = Math.min(58, (width - 32) / Math.max(3.4, max[0] - min[0]));
  return {
    columns,
    scale,
    bounds: [min, max] as const,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2],
    height: Math.max(220, (max[1] - min[1]) * scale + 88),
  };
}
