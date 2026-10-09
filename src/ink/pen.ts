import rough from 'roughjs';
import type { Options } from 'roughjs/bin/core.js';
import { seed, svg } from './dom.js';
import { strokes } from './strokes.js';
import { marker } from './marker.js';

export type Point = readonly [number, number];
export type Fill = 'none' | 'marker' | 'hatch';
export interface PenStyle {
  fill?: Fill;
  width?: number;
  pencil?: boolean;
  /** A quiet construction edge can surround a saturated colour wash. */
  stroke?: 'ink' | 'pencil' | 'currentColor';
}
type Bounds = { x: number; y: number; width: number; height: number };

function strokeVertices(points: readonly Point[], closed: boolean) {
  const distinct = points.filter(
    (p, i) => !i || p[0] !== points[i - 1]![0] || p[1] !== points[i - 1]![1],
  );
  if (
    closed &&
    distinct.length > 1 &&
    distinct[0]![0] === distinct.at(-1)![0] &&
    distinct[0]![1] === distinct.at(-1)![1]
  )
    distinct.pop();
  return distinct;
}

/** A slight bend carries the hand through; a deliberate corner starts another movement. */
function strokeTravel(lengths: number[], carry: number[], closed: boolean, reverse: boolean) {
  const result = new Array<number>(carry.length),
    cycle = closed ? carry.reduce((product, weight) => product * weight, 1) : 0;
  let travel = 0;
  for (let pass = 0; pass < (closed ? 2 : 1); pass++) {
    for (let step = 0; step < carry.length; step++) {
      const i = reverse ? carry.length - 1 - step : step,
        edge = reverse ? i : (i + carry.length - 1) % carry.length;
      travel = (travel + lengths[edge]!) * carry[i]!;
      result[i] = travel;
    }
    // Solve the closed traversal once, so its starting vertex does not set the phase.
    if (closed && pass === 0) travel = cycle < 1 ? travel / (1 - cycle) : 0;
  }
  return result;
}

/** Measured boundaries keep one quiet hand in the local direction and distance of travel. */
export function contourGeometry(points: readonly Point[], id: string, width = 1.65, closed = true) {
  if (
    points.length < (closed ? 3 : 2) ||
    points.some((p) => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))
  )
    throw new Error('A contour or trace needs finite points');
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const [x, y] of points) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  const bounds = { x: left, y: top, width: right - left, height: bottom - top };
  if (!Number.isFinite(bounds.width) || !Number.isFinite(bounds.height))
    throw new Error('Contour bounds must be finite');
  const vertices = strokeVertices(points, closed);
  const phase = ((seed(id) % 65536) / 65536) * Math.PI * 2;
  const amplitude = width * 0.18,
    primary = 0.7 * Math.cos(phase),
    secondary = 0.3 * Math.sin(phase);
  const lengths = vertices.map((a, i) => {
    if (!closed && i === vertices.length - 1) return 0;
    const b = vertices[(i + 1) % vertices.length]!;
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  });
  if (lengths.some((length) => !Number.isFinite(length)))
    throw new Error('Contour spans must be finite');
  const normals = vertices.map((a, i): Point => {
    const b = vertices[(i + 1) % vertices.length]!,
      length = lengths[i]!;
    return length ? [-(b[1] - a[1]) / length, (b[0] - a[0]) / length] : [0, 0];
  });
  const carry = normals.map((b, i) => {
    if (!closed && (i === 0 || i === vertices.length - 1)) return 0;
    const a = normals[(i + vertices.length - 1) % vertices.length]!,
      turn = Math.atan2(Math.abs(a[0] * b[1] - a[1] * b[0]), a[0] * b[0] + a[1] * b[1]);
    // A 45° corner finishes the movement; shallower bends carry it through continuously.
    return 1 - Math.sin(Math.min(Math.PI / 2, turn * 2));
  });
  const before = strokeTravel(lengths, carry, closed, false),
    after = strokeTravel(lengths, carry, closed, true);
  const sway = (from: number, to: number) => {
    if (!from || !to) return 0;
    const span = from + to,
      travel = (from - to) / (2 * Math.max(1, span / 4096));
    // Reversed travel and normal cancel. The phase belongs to this movement of the hand.
    return (
      amplitude *
      Math.sin((Math.PI * from) / span) *
      (primary * Math.sin(travel * 0.043) + secondary * Math.sin(travel * 0.091))
    );
  };
  const ink: string[] = [];
  for (let i = 0; i < vertices.length - (closed ? 0 : 1); i++) {
    const a = vertices[i]!,
      b = vertices[(i + 1) % vertices.length]!,
      dx = b[0] - a[0],
      dy = b[1] - a[1],
      length = lengths[i]!,
      next = (i + 1) % vertices.length,
      previous = (i + vertices.length - 1) % vertices.length;
    if (!length) continue;
    // A tiny change in length must not redistribute samples along the whole side.
    const spacing = 8 * Math.max(1, (before[i]! + length + after[next]!) / 4096),
      sampleOrigin = (before[i]! - length - after[next]!) / 2,
      firstSample = spacing - (((sampleOrigin % spacing) + spacing) % spacing);
    const hasPrevious = closed || i > 0,
      vertexSway = hasPrevious
        ? (sway(before[previous]! + lengths[previous]!, after[i]!) +
            sway(before[i]!, length + after[next]!)) /
          2
        : 0;
    const normal = normals[i]!,
      nx = normal[0] + (hasPrevious ? normals[previous]![0] : 0),
      ny = normal[1] + (hasPrevious ? normals[previous]![1] : 0),
      normalLength = Math.hypot(nx, ny) || 1;
    for (
      let travelled = 0;
      travelled < length;
      travelled = travelled ? travelled + spacing : firstSample
    ) {
      const t = travelled / length,
        offset = travelled
          ? sway(before[i]! + travelled, length - travelled + after[next]!)
          : vertexSway;
      const px = a[0] + dx * t + (travelled ? normal[0] : nx / normalLength) * offset,
        py = a[1] + dy * t + (travelled ? normal[1] : ny / normalLength) * offset;
      ink.push(`${ink.length ? 'L' : 'M'}${px} ${py}`);
    }
  }
  if (!closed || !ink.length)
    ink.push(`${ink.length ? 'L' : 'M'}${points.at(-1)![0]} ${points.at(-1)![1]}`);
  return {
    path: points.map(([x, y], i) => `${i ? 'L' : 'M'}${x} ${y}`).join('') + (closed ? 'Z' : ''),
    outline: ink.join('') + (closed ? 'Z' : ''),
    bounds,
  };
}
let nextCanvasId = 0;
export function roundedRect(x: number, y: number, width: number, height: number, radius = 3) {
  const r = Math.min(radius, width / 2, height / 2);
  return `M${x + r} ${y} H${x + width - r} Q${x + width} ${y} ${x + width} ${y + r} V${y + height - r} Q${x + width} ${y + height} ${x + width - r} ${y + height} H${x + r} Q${x} ${y + height} ${x} ${y + height - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

/** Authored paths use Rough; measured contours keep their geometry. Materials and motion are shared. */
export function pen(canvas: SVGSVGElement) {
  if (!canvas.id) {
    let id: string;
    do {
      id = `vs-ink-${++nextCanvasId}`;
    } while (document.getElementById(id));
    canvas.id = id;
  }
  const renderer = rough.svg(canvas);
  function draw(
    parent: SVGElement,
    id: string,
    path: string,
    style: PenStyle = {},
    measured?: () => string,
    initialBounds?: Bounds,
  ) {
    const key = [...id].map((char) => char.codePointAt(0)!.toString(16)).join('-');
    const elementId = `${canvas.id}-stroke-${key}`;
    if (canvas.getElementById(elementId)) throw new Error(`Duplicate drawing id: ${id}`);
    const element = svg('g', { id: elementId, 'data-stroke': id });
    parent.append(element);
    const options: Options = {
      seed: seed(id),
      roughness: 0.38,
      bowing: 0.6,
      stroke:
        style.stroke === 'pencil'
          ? 'var(--ve-pencil)'
          : style.stroke === 'ink'
            ? 'var(--ve-ink)'
            : 'currentColor',
      strokeWidth: style.width ?? 1.65,
      disableMultiStroke: true,
      disableMultiStrokeFill: true,
    };
    const fill = style.fill ?? 'none';
    let shapeClip: SVGPathElement | undefined;
    const boundary = (path: string) => {
      if (!measured) return renderer.path(path, options);
      const group = svg('g');
      group.append(
        svg('path', {
          d: measured(),
          fill: 'none',
          stroke: options.stroke!,
          'stroke-width': options.strokeWidth!,
        }),
      );
      return group;
    };
    let moveWash = (_bounds: Bounds) => {};
    let fillPaths: SVGPathElement[] = [];
    let paint = (_progress: number) => {};
    if (fill !== 'none') {
      const clipId = `${canvas.id}-fill-${key}`;
      const clip = svg('clipPath', { id: clipId });
      shapeClip = svg('path', { d: path });
      clip.append(shapeClip);
      const definitions = svg('defs');
      definitions.append(clip);
      element.append(definitions);
      if (fill === 'marker') {
        const geometryBounds =
          initialBounds ??
          (() => {
            const geometry = svg('path', { d: path });
            element.append(geometry);
            const bounds = geometry.getBBox();
            geometry.remove();
            return bounds;
          })();
        // A material region may start with zero area (energy, integral, split).
        // Keep a non-degenerate brush and let the actual contour clip it to zero.
        const bounds = {
          x: geometryBounds.x,
          y: geometryBounds.y,
          width: Math.max(1, geometryBounds.width),
          height: Math.max(1, geometryBounds.height),
        };
        const revealClip = svg('clipPath', { id: `${clipId}-reveal` });
        const window = svg('rect', {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        });
        revealClip.append(window);
        definitions.append(revealClip);
        const wash = svg('g', { 'clip-path': `url(#${clipId})` });
        const reveal = svg('g', { 'clip-path': `url(#${clipId}-reveal)` });
        reveal.append(marker(clipId, bounds.x, bounds.y, bounds.width, bounds.height, seed(id)));
        wash.append(reveal);
        element.append(wash);
        paint = (progress) =>
          window.setAttribute('width', String(bounds.width * Math.max(0, Math.min(1, progress))));
        moveWash = (next) =>
          reveal.setAttribute(
            'transform',
            `translate(${next.x} ${next.y}) scale(${next.width / (bounds.width || 1)} ${next.height / (bounds.height || 1)}) translate(${-bounds.x} ${-bounds.y})`,
          );
      } else {
        const wash = renderer.path(path, {
          ...options,
          stroke: 'none',
          fill: 'currentColor',
          fillStyle: 'hachure',
          hachureAngle: -42,
          hachureGap: 6,
          fillWeight: 0.85,
        });
        wash.classList.add('vs-hatch');
        wash.setAttribute('clip-path', `url(#${clipId})`);
        element.append(wash);
        fillPaths = [...wash.querySelectorAll('path')];
      }
    }
    const outline = boundary(path);
    outline.setAttribute('stroke-linecap', 'round');
    outline.setAttribute('stroke-linejoin', 'round');
    if (style.pencil) outline.style.opacity = '.42';
    element.append(outline);
    // Paint order keeps outlines on top; drawing order traces before filling.
    let trace = strokes([...outline.querySelectorAll('path'), ...fillPaths]);
    let revealed: number | undefined,
      traceDirty = false;
    return {
      element,
      /** A moving boundary keeps its seeded pen and marker; callers supply geometric bounds. */
      update(nextPath: string, bounds?: Bounds) {
        if (nextPath === path) return;
        if (fill === 'hatch')
          throw new Error('Deforming hatch geometry is not supported; use marker or outline');
        path = nextPath;
        shapeClip?.setAttribute('d', path);
        const next = boundary(path);
        const currentPaths = [...outline.querySelectorAll('path')];
        const nextPaths = [...next.querySelectorAll('path')];
        if (currentPaths.length === nextPaths.length)
          currentPaths.forEach((node, i) =>
            node.setAttribute('d', nextPaths[i]!.getAttribute('d')!),
          );
        else outline.replaceChildren(...next.childNodes);
        traceDirty = true;
        if (revealed !== undefined) {
          trace = strokes([...outline.querySelectorAll('path'), ...fillPaths]);
          traceDirty = false;
          trace(revealed);
        }
        if (bounds) moveWash(bounds);
      },
      reveal(progress: number) {
        if (revealed === progress && !traceDirty) return;
        if (traceDirty) {
          trace = strokes([...outline.querySelectorAll('path'), ...fillPaths]);
          traceDirty = false;
        }
        revealed = progress;
        trace(progress);
        paint(progress);
      },
      dispose() {
        element.remove();
      },
    };
  }
  return {
    /** Open measured geometry shares the contour's stable hand and efficient update path. */
    polyline(parent: SVGElement, id: string, points: readonly Point[], style: PenStyle = {}) {
      let geometry = contourGeometry(points, id, style.width, false);
      const drawing = draw(
        parent,
        id,
        geometry.path,
        style,
        () => geometry.outline,
        geometry.bounds,
      );
      return {
        ...drawing,
        update(next: readonly Point[]) {
          geometry = contourGeometry(next, id, style.width, false);
          drawing.update(geometry.path, geometry.bounds);
        },
      };
    },
    path(parent: SVGElement, id: string, path: string, style: PenStyle = {}) {
      return draw(parent, id, path, style);
    },
    /** A deforming closed boundary with stable ink and the same marker/reveal lifecycle. */
    contour(parent: SVGElement, id: string, points: readonly Point[], style: PenStyle = {}) {
      if (style.fill === 'hatch')
        throw new Error('Deforming hatch geometry is not supported; use marker or outline');
      let geometry = contourGeometry(points, id, style.width);
      const drawing = draw(
        parent,
        id,
        geometry.path,
        style,
        () => geometry.outline,
        geometry.bounds,
      );
      return {
        ...drawing,
        update(next: readonly Point[]) {
          geometry = contourGeometry(next, id, style.width);
          drawing.update(geometry.path, geometry.bounds);
        },
      };
    },
    rect(
      parent: SVGElement,
      id: string,
      x: number,
      y: number,
      w: number,
      h: number,
      style: PenStyle = {},
    ) {
      return draw(parent, id, roundedRect(x, y, w, h), style);
    },
    line(parent: SVGElement, id: string, from: Point, to: Point, style: PenStyle = {}) {
      return draw(parent, id, `M${from[0]} ${from[1]} L${to[0]} ${to[1]}`, style);
    },
    ellipse(
      parent: SVGElement,
      id: string,
      x: number,
      y: number,
      rx: number,
      ry = rx,
      style: PenStyle = {},
    ) {
      return draw(
        parent,
        id,
        `M${x - rx} ${y} A${rx} ${ry} 0 1 0 ${x + rx} ${y} A${rx} ${ry} 0 1 0 ${x - rx} ${y} Z`,
        style,
      );
    },
    arrow(parent: SVGElement, id: string, from: Point, to: Point, style: PenStyle = {}) {
      const path = (from: Point, to: Point) => {
        const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
        const wing = (delta: number) =>
          `${to[0] - 9 * Math.cos(angle + delta)} ${to[1] - 9 * Math.sin(angle + delta)}`;
        return `M${from.join(' ')} L${to.join(' ')} M${wing(0.48)} Q${to.join(' ')} ${wing(-0.48)}`;
      };
      const mark = draw(parent, id, path(from, to), style);
      return { ...mark, between: (from: Point, to: Point) => mark.update(path(from, to)) };
    },
  };
}
export type Pen = ReturnType<typeof pen>;
