import { svg as element } from '../ink/dom.js';
import { connectionRoute, crossesBounds, type ConnectionSide } from './connection.js';

interface Point {
  x: number;
  y: number;
}
interface Route {
  start: Point;
  end: Point;
  points?: readonly Point[];
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

/** Endpoints are in `space`, the link parent's coordinates (surface.layer under a camera). */
function connect(
  from: SVGGraphicsElement,
  to: SVGGraphicsElement,
  {
    fromShape = 'rect',
    toShape = 'rect',
    gap = 3,
    space = from.ownerSVGElement!,
    avoid = [],
    route = avoid.length ? 'orthogonal' : 'straight',
    clearance = 8,
    fromSide,
    toSide,
  }: {
    fromShape?: string;
    toShape?: string;
    gap?: number;
    space?: SVGGraphicsElement;
    avoid?: readonly SVGGraphicsElement[];
    route?: 'straight' | 'orthogonal';
    clearance?: number;
    fromSide?: ConnectionSide;
    toSide?: ConnectionSide;
  } = {},
) {
  const a = box(from, space),
    b = from === to ? a : box(to, space);
  if (route === 'orthogonal') {
    const connection = connectionRoute(a, b, {
      gap,
      clearance,
      fromSide,
      toSide,
      avoid: avoid
        .filter((node) => node !== from && node !== to && shown(node))
        .map((node) => box(node, space)),
    });
    return {
      ...connection,
      d: connection.points.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(''),
    };
  }
  const start = edge(a, { x: b.cx, y: b.cy }, { shape: fromShape, gap });
  const end = edge(b, { x: a.cx, y: a.cy }, { shape: toShape, gap });
  return { start, end, points: [start, end], d: `M${start.x} ${start.y}L${end.x} ${end.y}` };
}

function shown(node: SVGGraphicsElement) {
  for (let parent: Element | null = node; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0)
      return false;
  }
  return true;
}
function segments(route: Route) {
  const points = route.points ?? [route.start, route.end];
  return points.slice(1).map((end, i) => ({ start: points[i]!, end }));
}
const crosses = (route: Route, bounds: Bounds) =>
  segments(route).some(({ start, end }) => crossesBounds(start, end, bounds));

function along(
  label: SVGGraphicsElement,
  route: Route,
  {
    at = 0.5,
    offset = 16,
    avoid = [],
    gap = 4,
    space = label.parentElement as unknown as SVGGraphicsElement,
  }: {
    at?: number;
    offset?: number;
    avoid?: readonly (SVGGraphicsElement | Route)[];
    gap?: number;
    space?: SVGGraphicsElement;
  } = {},
) {
  const parts = segments(route).map((p) => ({
    ...p,
    length: Math.hypot(p.end.x - p.start.x, p.end.y - p.start.y),
  }));
  const length = parts.reduce((sum, p) => sum + p.length, 0) || 1;
  const location = (at: number) => {
    let remaining = Math.max(0, Math.min(1, at)) * length;
    let segment = parts.at(-1) ?? { start: route.start, end: route.end, length: 0 };
    for (const part of parts) {
      segment = part;
      if (remaining <= part.length) break;
      remaining -= part.length;
    }
    const dx = (segment.end.x - segment.start.x) / (segment.length || 1),
      dy = (segment.end.y - segment.start.y) / (segment.length || 1);
    return { x: segment.start.x + dx * remaining, y: segment.start.y + dy * remaining, dx, dy };
  };
  const ink = label.getBBox();
  const parentToSpace = space
    .getCTM()!
    .inverse()
    .multiply((label.parentElement as unknown as SVGGraphicsElement).getCTM()!);
  const spaceToParent = parentToSpace.inverse();
  const width = Math.abs(parentToSpace.a) * ink.width + Math.abs(parentToSpace.c) * ink.height;
  const height = Math.abs(parentToSpace.b) * ink.width + Math.abs(parentToSpace.d) * ink.height;
  const obstacles = avoid
    .filter((node) => 'start' in node || shown(node))
    .map((node) => ('start' in node ? node : box(node, space)));
  const normal = location(at);
  const normalRadius = (Math.abs(normal.dy) * width + Math.abs(normal.dx) * height) / 2;
  const preferred =
    offset === 0 ? 0 : Math.sign(offset) * Math.max(Math.abs(offset), normalRadius + gap);
  const step = Math.max(8, Math.min(width, height) / 2 + gap);
  const candidates: { at: number; distance: number; cost: number }[] = [];
  // Try nearby positions on the link before pushing a label far from its owner.
  for (let i = 0; i < 64; i++) {
    const distance = preferred + (i % 2 ? -1 : 1) * Math.ceil(i / 2) * step;
    if (offset !== 0 && Math.abs(distance) < normalRadius + gap) continue;
    for (const shift of [0, -0.12, 0.12, -0.24, 0.24, -0.36, 0.36]) {
      const position = Math.max(0, Math.min(1, at + shift));
      candidates.push({
        at: position,
        distance,
        cost: (distance - preferred) ** 2 + ((position - at) * length) ** 2,
      });
    }
  }
  candidates.sort((a, b) => a.cost - b.cost);
  let chosen = { at, distance: preferred };
  for (const candidate of candidates) {
    const p = location(candidate.at);
    const x = p.x - p.dy * candidate.distance;
    const y = p.y + p.dx * candidate.distance;
    const rect = {
      x: x - width / 2 - gap,
      y: y - height / 2 - gap,
      width: width + 2 * gap,
      height: height + 2 * gap,
    };
    if (
      (offset === 0 || !crosses(route, rect)) &&
      obstacles.every((b) =>
        'start' in b
          ? !crosses(b, rect)
          : rect.x + rect.width <= b.x ||
            rect.x >= b.x + b.width ||
            rect.y + rect.height <= b.y ||
            rect.y >= b.y + b.height,
      )
    ) {
      chosen = candidate;
      break;
    }
  }
  const p = location(chosen.at);
  const center = new DOMPoint(
    p.x - p.dy * chosen.distance,
    p.y + p.dx * chosen.distance,
  ).matrixTransform(spaceToParent);
  place(label, center.x, center.y);
}

// Reflow only when width changes. The callback returns the content height.
async function observe(svg: SVGSVGElement, layout: (width: number) => number | void) {
  await document.fonts.ready;
  let lastWidth = -1,
    disposed = false;
  const update = (force = true) => {
    if (disposed) return;
    // Layout uses local CSS units. A film frame or paper camera may transform
    // the entire SVG afterward; measuring screen pixels would scale it twice.
    const width = svg.clientWidth;
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
