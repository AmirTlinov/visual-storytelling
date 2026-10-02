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
let nextCanvasId = 0;
export function roundedRect(x: number, y: number, width: number, height: number, radius = 3) {
  const r = Math.min(radius, width / 2, height / 2);
  return `M${x + r} ${y} H${x + width - r} Q${x + width} ${y} ${x + width} ${y + r} V${y + height - r} Q${x + width} ${y + height} ${x + width - r} ${y + height} H${x + r} Q${x} ${y + height} ${x} ${y + height - r} V${y + r} Q${x} ${y} ${x + r} ${y} Z`;
}

/** Rough owns the geometry; this module owns materials, seeded identity and stroke order. */
export function pen(canvas: SVGSVGElement) {
  if (!canvas.id) {
    let id: string;
    do {
      id = `vs-ink-${++nextCanvasId}`;
    } while (document.getElementById(id));
    canvas.id = id;
  }
  const renderer = rough.svg(canvas);
  const drawings = new Map<string, SVGGElement>();
  function draw(parent: SVGElement, id: string, path: string, style: PenStyle = {}) {
    const previous = drawings.get(id);
    if (previous && canvas.contains(previous)) throw new Error(`Duplicate drawing id: ${id}`);
    const element = svg('g', { 'data-stroke': id });
    parent.append(element);
    drawings.set(id, element);
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
    let fillPaths: SVGPathElement[] = [];
    let paint = (_progress: number) => {};
    if (fill !== 'none') {
      const clipId = `${canvas.id}-fill-${[...id].map((char) => char.codePointAt(0)!.toString(16)).join('-')}`;
      const clip = svg('clipPath', { id: clipId });
      clip.append(svg('path', { d: path }));
      const definitions = svg('defs');
      definitions.append(clip);
      element.append(definitions);
      if (fill === 'marker') {
        const geometry = svg('path', { d: path });
        element.append(geometry);
        const bounds = geometry.getBBox();
        geometry.remove();
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
    const outline = renderer.path(path, options);
    outline.setAttribute('stroke-linecap', 'round');
    outline.setAttribute('stroke-linejoin', 'round');
    if (style.pencil) outline.style.opacity = '.42';
    element.append(outline);
    // Paint order keeps outlines on top; drawing order traces before filling.
    const trace = strokes([...outline.querySelectorAll('path'), ...fillPaths]);
    return {
      element,
      reveal(progress: number) {
        trace(progress);
        paint(progress);
      },
      dispose() {
        if (drawings.get(id) === element) drawings.delete(id);
        element.remove();
      },
    };
  }
  return {
    path: draw,
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
      const angle = Math.atan2(to[1] - from[1], to[0] - from[0]);
      const wing = (delta: number) =>
        `${to[0] - 9 * Math.cos(angle + delta)} ${to[1] - 9 * Math.sin(angle + delta)}`;
      return draw(
        parent,
        id,
        `M${from.join(' ')} L${to.join(' ')} M${wing(0.48)} Q${to.join(' ')} ${wing(-0.48)}`,
        style,
      );
    },
  };
}
export type Pen = ReturnType<typeof pen>;
