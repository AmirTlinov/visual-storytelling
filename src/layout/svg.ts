import { svg as element } from '../ink/dom.js';
import { connectionRoute, type ConnectionSide } from './connection.js';
import { placeLabels, type LabelSegment } from './labels.js';
import { labelOverflow, type OverflowLabel } from './label-overflow.js';

interface Point {
  x: number;
  y: number;
}
interface Route {
  start: Point;
  end: Point;
  points?: readonly Point[];
  width?: number;
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

/** Side and gap use the label parent's coordinates unless an explicit space is supplied. */
function beside(
  label: SVGGraphicsElement,
  target: SVGGraphicsElement,
  {
    side = 'bottom',
    gap = 10,
    space = label.parentElement as unknown as SVGGraphicsElement,
  }: { side?: 'bottom' | 'top' | 'left' | 'right'; gap?: number; space?: SVGGraphicsElement } = {},
) {
  const b = box(target, space);
  const ink = label.getBBox();
  const parentToSpace = space
    .getCTM()!
    .inverse()
    .multiply((label.parentElement as unknown as SVGGraphicsElement).getCTM()!);
  const width = Math.abs(parentToSpace.a) * ink.width + Math.abs(parentToSpace.c) * ink.height;
  const height = Math.abs(parentToSpace.b) * ink.width + Math.abs(parentToSpace.d) * ink.height;
  const positions: Record<string, [number, number]> = {
    bottom: [b.cx, b.y + b.height + gap + height / 2],
    top: [b.cx, b.y - gap - height / 2],
    left: [b.x - gap - width / 2, b.cy],
    right: [b.x + b.width + gap + width / 2, b.cy],
  };
  const [x, y] = positions[side]!;
  const center = new DOMPoint(x, y).matrixTransform(parentToSpace.inverse());
  place(label, center.x, center.y);
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
/** Visible SVG paper or clipped region in the caller's coordinates, including rotation and skew. */
function viewport(space: SVGGraphicsElement, inset = 0, region?: SVGGraphicsElement) {
  const svg = space instanceof SVGSVGElement ? space : space.ownerSVGElement!;
  const view = region?.getBBox() ?? svg.viewBox.baseVal;
  const width = Math.max(0, (view.width || (!region && svg.clientWidth) || 0) - 2 * inset),
    height = Math.max(0, (view.height || (!region && svg.clientHeight) || 0) - 2 * inset);
  if (width <= 0 || height <= 0) return { area: { x: view.x, y: view.y, width: 0, height: 0 } };
  const matrix = space
    .getCTM()!
    .inverse()
    .multiply((region ?? svg).getCTM()!);
  const boundary = [
    [view.x + inset, view.y + inset],
    [view.x + inset + width, view.y + inset],
    [view.x + inset + width, view.y + inset + height],
    [view.x + inset, view.y + inset + height],
  ].map(([x, y]) => {
    const p = new DOMPoint(x!, y!).matrixTransform(matrix);
    return { x: p.x, y: p.y };
  });
  const x = Math.min(...boundary.map((p) => p.x)),
    y = Math.min(...boundary.map((p) => p.y));
  return {
    area: {
      x,
      y,
      width: Math.max(...boundary.map((p) => p.x)) - x,
      height: Math.max(...boundary.map((p) => p.y)) - y,
    },
    boundary,
  };
}

function along(
  label: SVGGraphicsElement,
  route: Route,
  {
    at = 0.5,
    offset = 16,
    avoid = [],
    gap = 4,
    space = label.parentElement as unknown as SVGGraphicsElement,
    region,
  }: {
    at?: number;
    offset?: number;
    avoid?: readonly (SVGGraphicsElement | Route)[];
    gap?: number;
    space?: SVGGraphicsElement;
    /** A cropped SVG aperture; labels stay within its true transformed boundary. */
    region?: SVGGraphicsElement;
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
  // A previous overflow is owned by layout; author visibility remains untouched.
  label.removeAttribute('data-layout-status');
  const ink = label.getBBox();
  const parentToSpace = space
    .getCTM()!
    .inverse()
    .multiply((label.parentElement as unknown as SVGGraphicsElement).getCTM()!);
  const spaceToParent = parentToSpace.inverse();
  const width = Math.abs(parentToSpace.a) * ink.width + Math.abs(parentToSpace.c) * ink.height;
  const height = Math.abs(parentToSpace.b) * ink.width + Math.abs(parentToSpace.d) * ink.height;
  const obstacles = avoid
    .filter(
      (node): node is SVGGraphicsElement => !('start' in node) && node !== label && shown(node),
    )
    .map((node) => box(node, space));
  const routes = [
    ...(offset === 0 ? [] : [route]),
    ...avoid.filter((node): node is Route => 'start' in node),
  ];
  const strokes: LabelSegment[] = routes.flatMap((r) =>
    segments(r).map(({ start, end }) => ({
      from: [start.x, start.y],
      to: [end.x, end.y],
      width: r.width,
    })),
  );
  const normal = location(at);
  const normalRadius = (Math.abs(normal.dy) * width + Math.abs(normal.dx) * height) / 2;
  const distance =
    offset === 0 ? 0 : Math.sign(offset) * Math.max(Math.abs(offset), normalRadius + gap);
  const visible = viewport(space, 0, region);
  const [placement] = placeLabels(
    [
      {
        x: normal.x - normal.dy * distance - width / 2,
        y: normal.y + normal.dx * distance - height / 2,
        width,
        height,
      },
    ],
    visible.area,
    { obstacles, segments: strokes, boundary: visible.boundary, gap },
  );
  label.dataset.layoutStatus = placement!.status;
  if (placement!.status === 'placed') {
    const center = new DOMPoint(
      placement!.x + width / 2,
      placement!.y + height / 2,
    ).matrixTransform(spaceToParent);
    place(label, center.x, center.y);
  }
  return placement!;
}

/** A shared overflow action in SVG coordinates. Reserve its box before placing labels. */
function overflow(space: SVGGraphicsElement, { region }: { region?: SVGGraphicsElement } = {}) {
  const frame = element('foreignObject', { 'data-svg-overflow': '', 'pointer-events': 'none' });
  const host = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
  host.style.cssText = 'position:relative;width:100%;height:100%';
  frame.append(host);
  const obstacle = element('rect', {
    fill: 'none',
    'pointer-events': 'none',
    'aria-hidden': 'true',
  });
  const summary = element('desc');
  space.append(obstacle, frame, summary);
  const control = labelOverflow(host);
  let area = { x: 0, y: 0, width: 0, height: 0 };
  let position = { ...area };
  return {
    /** The returned transparent rectangle is a real solver obstacle, even before overflow occurs. */
    reserve() {
      area = viewport(space, 4, region).area;
      for (const key of ['x', 'y', 'width', 'height'] as const)
        frame.setAttribute(key, String(area[key]));
      position = control.preferred({ ...area, x: 0, y: 0 });
      for (const key of ['x', 'y', 'width', 'height'] as const)
        obstacle.setAttribute(
          key,
          String(position[key] + (key === 'x' ? area.x : key === 'y' ? area.y : 0)),
        );
      return obstacle;
    },
    update(items: readonly OverflowLabel[]) {
      control.update(items, position);
      summary.textContent = items.length
        ? `Неуместившиеся подписи: ${items.map((item) => (item.subject && item.subject !== item.label ? `${item.subject}: ${item.label}` : item.label)).join('; ')}.`
        : '';
    },
    dispose() {
      control.dispose();
      obstacle.remove();
      frame.remove();
      summary.remove();
    },
  };
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

export const SvgLayout = {
  element,
  box,
  place,
  row,
  beside,
  edge,
  connect,
  along,
  viewport,
  overflow,
  observe,
};
