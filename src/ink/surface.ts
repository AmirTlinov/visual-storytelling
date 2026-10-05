import { svg, seed } from './dom.js';
import { pen } from './pen.js';

export interface Grid {
  step: number;
  x?: number;
  y?: number;
}
export interface SurfaceOptions {
  id: string;
  width: number;
  height: number;
  title: string;
  description: string;
  grid?: Grid | false;
}

export function surface(parent: HTMLElement, options: SurfaceOptions) {
  const cleanups = new Set<() => void>();
  let disposed = false;
  if (!/^[a-zA-Z][\w-]*$/.test(options.id) || document.getElementById(options.id))
    throw new Error('Surface id must be valid and unique in the document');
  const element = svg('svg', {
    id: options.id,
    class: 'vs-canvas',
    xmlns: 'http://www.w3.org/2000/svg',
    role: 'img',
    'aria-labelledby': `${options.id}-title ${options.id}-desc`,
  });
  element.append(
    svg('title', { id: `${options.id}-title` }, options.title),
    svg('desc', { id: `${options.id}-desc` }, options.description),
  );
  const paper = svg('g', { 'aria-hidden': 'true', class: 'vs-grid', 'data-camera-transform': '' });
  const layer = svg('g', { 'data-camera-world': '', 'data-camera-transform': '' });
  element.append(paper, layer);
  parent.append(element);
  let width = 0,
    height = 0,
    viewportRatio: number | undefined,
    gridSignature = '';
  let gridOptions: Grid | false = options.grid ?? { step: 30 };
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  const drawGrid = (grid: Grid | false = gridOptions) => {
    if (grid && (!(grid.step > 0) || !Number.isFinite(grid.step)))
      throw new Error('Grid step must be positive');
    gridOptions = grid && { ...grid };
    const signature = grid
      ? [bounds.x, bounds.y, bounds.width, bounds.height, grid.step, grid.x ?? 0, grid.y ?? 0].join(
          ',',
        )
      : 'none';
    if (signature === gridSignature) return;
    gridSignature = signature;
    paper.replaceChildren();
    if (!grid) return;
    const parts: string[] = [];
    const left = bounds.x,
      top = bounds.y,
      right = left + bounds.width,
      bottom = top + bounds.height;
    const start = (edge: number, origin = 0) =>
      origin + Math.ceil((edge - origin) / grid.step) * grid.step;
    for (let x = start(left, grid.x); x <= right; x += grid.step) {
      const bow = ((seed(`${options.id}:v:${x}`) % 13) - 6) / 12;
      parts.push(`M${x} ${top} Q${x + bow} ${(top + bottom) / 2} ${x} ${bottom}`);
    }
    for (let y = start(top, grid.y); y <= bottom; y += grid.step) {
      const bow = ((seed(`${options.id}:h:${y}`) % 13) - 6) / 12;
      parts.push(`M${left} ${y} Q${(left + right) / 2} ${y + bow} ${right} ${y}`);
    }
    paper.append(
      svg('path', {
        d: parts.join(' '),
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1,
      }),
    );
  };
  const updateViewport = () => {
    const w = viewportRatio ? Math.max(width, height * viewportRatio) : width;
    const h = viewportRatio ? Math.max(height, width / viewportRatio) : height;
    const x = (width - w) / 2,
      y = (height - h) / 2;
    if (bounds.x !== x || bounds.y !== y || bounds.width !== w || bounds.height !== h) {
      bounds = { x, y, width: w, height: h };
      element.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
      element.style.aspectRatio = `${w} / ${h}`;
    }
    drawGrid();
  };
  const resize = (w: number, h: number, grid: Grid | false = gridOptions) => {
    if (![w, h].every((value) => Number.isFinite(value) && value > 0))
      throw new Error('Surface dimensions must be positive');
    width = w;
    height = h;
    gridOptions = grid;
    updateViewport();
  };
  /** Expand the visible paper around fixed artwork without moving its coordinates or grid origin. */
  const fitViewport = (w: number, h: number) => {
    if (![w, h].every((value) => Number.isFinite(value) && value > 0))
      throw new Error('Viewport dimensions must be positive');
    viewportRatio = w / h;
    updateViewport();
  };
  resize(options.width, options.height);
  return {
    element,
    layer,
    pen: pen(element),
    resize,
    fitViewport,
    grid: drawGrid,
    onDispose(cleanup: () => void) {
      if (disposed) throw new Error('Drawing surface has been disposed');
      cleanups.add(cleanup);
      return () => {
        cleanups.delete(cleanup);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const cleanup of [...cleanups]) cleanup();
      cleanups.clear();
      element.remove();
    },
  };
}
export type Surface = ReturnType<typeof surface>;
