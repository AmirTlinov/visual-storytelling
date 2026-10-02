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
  const paper = svg('g', { 'aria-hidden': 'true', class: 'vs-grid' });
  const layer = svg('g');
  element.append(paper, layer);
  parent.append(element);
  let width = options.width,
    height = options.height;
  const drawGrid = (grid: Grid | false = { step: 30 }) => {
    paper.replaceChildren();
    if (!grid) return;
    if (!(grid.step > 0) || !Number.isFinite(grid.step))
      throw new Error('Grid step must be positive');
    const parts: string[] = [];
    for (let x = (grid.x ?? 0) % grid.step; x <= width; x += grid.step) {
      const bow = ((seed(`${options.id}:v:${x}`) % 13) - 6) / 12;
      parts.push(`M${x} 0 Q${x + bow} ${height / 2} ${x} ${height}`);
    }
    for (let y = (grid.y ?? 0) % grid.step; y <= height; y += grid.step) {
      const bow = ((seed(`${options.id}:h:${y}`) % 13) - 6) / 12;
      parts.push(`M0 ${y} Q${width / 2} ${y + bow} ${width} ${y}`);
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
  const resize = (w: number, h: number, grid: Grid | false = options.grid ?? { step: 30 }) => {
    if (![w, h].every((value) => Number.isFinite(value) && value > 0))
      throw new Error('Surface dimensions must be positive');
    width = w;
    height = h;
    element.setAttribute('viewBox', `0 0 ${w} ${h}`);
    element.style.aspectRatio = `${w} / ${h}`;
    drawGrid(grid);
  };
  resize(width, height);
  return {
    element,
    layer,
    pen: pen(element),
    resize,
    grid: drawGrid,
    dispose() {
      element.remove();
    },
  };
}
export type Surface = ReturnType<typeof surface>;
