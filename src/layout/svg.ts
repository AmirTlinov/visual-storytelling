import { svg as element } from '../ink/dom.js';

interface Point {
  x: number;
  y: number;
}
interface Bounds extends Point {
  width: number;
  height: number;
  cx?: number;
  cy?: number;
}

/* Geometry is measured in the parent SVG's coordinates. Layout owns outer groups;
   animate an inner group so placement and motion never compete for a transform. */

function box(node: SVGGraphicsElement, space: SVGGraphicsElement = node.ownerSVGElement!) {
  const b = node.getBBox();
  const matrix = space.getCTM()!.inverse().multiply(node.getCTM()!);
  const points = [
    [b.x, b.y],
    [b.x + b.width, b.y],
    [b.x, b.y + b.height],
    [b.x + b.width, b.y + b.height],
  ].map(([x, y]) => new DOMPoint(x!, y!).matrixTransform(matrix));
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  const width = Math.max(...points.map((p) => p.x)) - x;
  const height = Math.max(...points.map((p) => p.y)) - y;
  return { x, y, width, height, cx: x + width / 2, cy: y + height / 2 };
}

function place(node: SVGGraphicsElement, x: number, y: number, { anchor = 'center' } = {}) {
  const b = node.getBBox();
  const ax = anchor.includes('left')
    ? b.x
    : anchor.includes('right')
      ? b.x + b.width
      : b.x + b.width / 2;
  const ay = anchor.includes('top')
    ? b.y
    : anchor.includes('bottom')
      ? b.y + b.height
      : b.y + b.height / 2;
  node.setAttribute('transform', `translate(${x - ax} ${y - ay})`);
}

function row(nodes: SVGGraphicsElement[], { x = 0, y = 0, gap = 12, align = 'center' } = {}) {
  const sizes = nodes.map((node) => node.getBBox());
  const width = sizes.reduce((sum, b) => sum + b.width, 0) + gap * Math.max(0, nodes.length - 1);
  let cursor = x - (align === 'center' ? width / 2 : align === 'right' ? width : 0);
  nodes.forEach((node, i) => {
    place(node, cursor, y, { anchor: 'left' });
    cursor += sizes[i]!.width + gap;
  });
  return width;
}

function beside(
  label: SVGGraphicsElement,
  target: SVGGraphicsElement,
  {
    side = 'bottom',
    gap = 10,
    space = target.ownerSVGElement!,
  }: { side?: 'bottom' | 'top' | 'left' | 'right'; gap?: number; space?: SVGGraphicsElement } = {},
) {
  const b = box(target, space);
  const positions: Record<string, [number, number, string]> = {
    bottom: [b.cx, b.y + b.height + gap, 'top'],
    top: [b.cx, b.y - gap, 'bottom'],
    left: [b.x - gap, b.cy, 'right'],
    right: [b.x + b.width + gap, b.cy, 'left'],
  };
  const [x, y, anchor] = positions[side]!;
  place(label, x, y, { anchor });
}

function edge(bounds: Bounds, toward: Point, { shape = 'rect', gap = 0 } = {}) {
  const cx = bounds.cx ?? bounds.x + bounds.width / 2;
  const cy = bounds.cy ?? bounds.y + bounds.height / 2;
  const dx = toward.x - cx,
    dy = toward.y - cy,
    length = Math.hypot(dx, dy);
  if (!length) return { x: cx, y: cy };
  const rx = Math.max(bounds.width / 2, 0.001),
    ry = Math.max(bounds.height / 2, 0.001);
  const factor =
    shape === 'ellipse'
      ? 1 / Math.hypot(dx / rx, dy / ry)
      : 1 / Math.max(Math.abs(dx) / rx, Math.abs(dy) / ry);
  return { x: cx + dx * factor + (dx / length) * gap, y: cy + dy * factor + (dy / length) * gap };
}

function connect(
  from: SVGGraphicsElement,
  to: SVGGraphicsElement,
  { fromShape = 'rect', toShape = 'rect', gap = 3, space = from.ownerSVGElement! } = {},
) {
  const a = box(from, space),
    b = box(to, space);
  const start = edge(a, { x: b.cx, y: b.cy }, { shape: fromShape, gap });
  const end = edge(b, { x: a.cx, y: a.cy }, { shape: toShape, gap });
  return { start, end, d: `M${start.x} ${start.y}L${end.x} ${end.y}` };
}

function along(
  label: SVGGraphicsElement,
  { start, end }: { start: Point; end: Point },
  { at = 0.5, offset = 16 } = {},
) {
  const dx = end.x - start.x,
    dy = end.y - start.y,
    length = Math.hypot(dx, dy) || 1;
  place(
    label,
    start.x + dx * at - (dy / length) * offset,
    start.y + dy * at + (dx / length) * offset,
  );
}

// Reflow only when width changes. The callback returns the content height.
async function observe(svg: SVGSVGElement, layout: (width: number) => number | void) {
  await document.fonts.ready;
  let lastWidth = -1,
    disposed = false;
  const update = (force = true) => {
    if (disposed) return;
    const width = Math.round(svg.getBoundingClientRect().width);
    if (!width || (!force && width === lastWidth)) return;
    lastWidth = width;
    const height = layout(width);
    if (Number.isFinite(height)) {
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
      svg.style.height = `${height}px`;
    }
  };
  const observer = new ResizeObserver(() => update(false));
  observer.observe(svg);
  const fontsChanged = () => update();
  document.fonts.addEventListener('loadingdone', fontsChanged);
  update();
  return {
    update,
    dispose() {
      disposed = true;
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', fontsChanged);
    },
  };
}

export const SvgLayout = { element, box, place, row, beside, edge, connect, along, observe };
