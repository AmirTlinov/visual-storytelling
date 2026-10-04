import { partBounds } from './measure.js';
import type { MathMorphPlan } from './types.js';

const viewports = new WeakMap<
  HTMLElement,
  {
    clients: Map<symbol, number>;
    layout: string | null;
    height: string;
    priority: string;
  }
>();

/** A shared host fits every active composition; its last client restores the original CSS. */
export function cellViewport(host: HTMLElement) {
  const client = Symbol();
  let disposed = false;
  function resize(height?: number) {
    if (disposed) return;
    let state = viewports.get(host);
    if (height === undefined) {
      if (!state?.clients.delete(client)) return;
    } else {
      if (!state) {
        state = {
          clients: new Map(),
          layout: host.getAttribute('data-math-layout'),
          height: host.style.getPropertyValue('--ve-math-height'),
          priority: host.style.getPropertyPriority('--ve-math-height'),
        };
        viewports.set(host, state);
      }
      if (state.clients.get(client) === height) return;
      state.clients.set(client, height);
    }
    if (state.clients.size) {
      host.setAttribute('data-math-layout', 'cells');
      host.style.setProperty('--ve-math-height', `${Math.max(...state.clients.values())}px`);
    } else {
      if (state.layout === null) host.removeAttribute('data-math-layout');
      else host.setAttribute('data-math-layout', state.layout);
      if (state.height) host.style.setProperty('--ve-math-height', state.height, state.priority);
      else host.style.removeProperty('--ve-math-height');
      viewports.delete(host);
    }
  }
  return {
    resize,
    dispose() {
      resize();
      disposed = true;
    },
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
