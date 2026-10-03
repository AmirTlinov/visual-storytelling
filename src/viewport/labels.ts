import * as T from './engine.js';
import type { Camera } from 'three';

export type Face = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
export interface LabelOptions {
  tone?: string;
  offset?: [number, number];
  visible?: () => boolean;
  /** A mesh face owns its complete label. Small/edge-on faces use a readable callout. */
  face?: Face;
  size?: number;
  minSize?: number;
}
type Anchor = T.Object3D | (() => T.Vector3);
interface Label {
  element: HTMLSpanElement;
  leader: SVGPathElement;
  text: string | (() => string);
  anchor: Anchor;
  options: LabelOptions;
}
interface Box {
  x: number;
  y: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}
type Point = { x: number; y: number };

function faceCorners(mesh: T.Mesh, side: Face) {
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  const { min: a, max: b } = mesh.geometry.boundingBox!;
  const faces = {
    front: [
      [a.x, a.y, b.z],
      [b.x, a.y, b.z],
      [b.x, b.y, b.z],
      [a.x, b.y, b.z],
    ],
    back: [
      [b.x, a.y, a.z],
      [a.x, a.y, a.z],
      [a.x, b.y, a.z],
      [b.x, b.y, a.z],
    ],
    right: [
      [b.x, a.y, b.z],
      [b.x, a.y, a.z],
      [b.x, b.y, a.z],
      [b.x, b.y, b.z],
    ],
    left: [
      [a.x, a.y, a.z],
      [a.x, a.y, b.z],
      [a.x, b.y, b.z],
      [a.x, b.y, a.z],
    ],
    top: [
      [a.x, b.y, b.z],
      [b.x, b.y, b.z],
      [b.x, b.y, a.z],
      [a.x, b.y, a.z],
    ],
    bottom: [
      [a.x, a.y, a.z],
      [b.x, a.y, a.z],
      [b.x, a.y, b.z],
      [a.x, a.y, b.z],
    ],
  };
  mesh.updateWorldMatrix(true, false);
  return faces[side].map((p) => mesh.localToWorld(new T.Vector3(p[0], p[1], p[2])));
}

function inside(point: Point, polygon: Point[], padding: number) {
  const signs = polygon.map((a, i) => {
    const b = polygon[(i + 1) % polygon.length]!;
    return (
      ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) /
      (Math.hypot(b.x - a.x, b.y - a.y) || 1)
    );
  });
  return signs.every((n) => n >= padding) || signs.every((n) => n <= -padding);
}

/** Own projection, measured text, face visibility and callout collision handling together. */
export function projectedLabels(stage: HTMLElement, camera: Camera, invalidate: () => void) {
  const labels = new Set<Label>();
  const leaders = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  leaders.style.cssText = 'position:absolute;inset:0;pointer-events:none';
  leaders.setAttribute('aria-hidden', 'true');
  stage.append(leaders);
  const projection = (v: T.Vector3, w: number, h: number) => {
    const p = v.clone().project(camera);
    return { x: ((p.x + 1) * w) / 2, y: ((1 - p.y) * h) / 2, z: p.z };
  };
  function render() {
    const width = stage.clientWidth,
      height = stage.clientHeight,
      placed: Box[] = [];
    leaders.setAttribute('viewBox', `0 0 ${width} ${height}`);
    const measured = [...labels]
      .sort((a, b) => Number(!!b.options.face) - Number(!!a.options.face))
      .map((item) => {
        const { element, options } = item;
        element.hidden = false;
        element.style.fontSize = options.size ? `${options.size}px` : '';
        if (typeof item.text === 'function') {
          const text = item.text();
          if (element.textContent !== text) element.textContent = text;
        }
        delete element.dataset.layoutError;
        return {
          item,
          half: element.scrollWidth / 2,
          high: element.offsetHeight / 2,
          size: parseFloat(getComputedStyle(element).fontSize),
        };
      });
    for (const { item, half, high, size } of measured) {
      const { element, leader, options } = item,
        offset = options.offset ?? [0, 0];
      const corners = options.face ? faceCorners(item.anchor as T.Mesh, options.face) : undefined;
      const point = corners
        ? corners.reduce((sum, p) => sum.add(p), new T.Vector3()).multiplyScalar(0.25)
        : typeof item.anchor === 'function'
          ? item.anchor()
          : new T.Box3().setFromObject(item.anchor).getCenter(new T.Vector3());
      const anchor = projection(point, width, height);
      const polygon = corners?.map((p) => projection(p, width, height));
      element.hidden = options.visible?.() === false || anchor.z < -1 || anchor.z > 1;
      leader.style.display = 'none';
      if (corners) {
        const normal = corners[1]!
          .clone()
          .sub(corners[0]!)
          .cross(corners[2]!.clone().sub(corners[0]!));
        if (normal.dot(camera.getWorldPosition(new T.Vector3()).sub(point)) <= 1e-9)
          element.hidden = true;
      }
      if (element.hidden) continue;
      let box: Box | undefined;
      const rectangle = (x: number, y: number, scale = 1): Box => ({
        x,
        y,
        left: x - half * scale,
        right: x + half * scale,
        top: y - high * scale,
        bottom: y + high * scale,
      });
      const vacant = (b: Box) =>
        b.left >= 8 &&
        b.right <= width - 8 &&
        b.top >= 8 &&
        b.bottom <= height - 8 &&
        placed.every(
          (other) =>
            b.right + 6 < other.left ||
            b.left - 6 > other.right ||
            b.bottom + 6 < other.top ||
            b.top - 6 > other.bottom,
        );
      if (corners) {
        const fits = (scale: number) => {
          const b = rectangle(anchor.x + offset[0], anchor.y + offset[1], scale);
          return [
            { x: b.left, y: b.top },
            { x: b.right, y: b.top },
            { x: b.right, y: b.bottom },
            { x: b.left, y: b.bottom },
          ].every((p) => inside(p, polygon!, 3));
        };
        let lo = 0,
          hi = 1;
        for (let i = 0; i < 16; i++) {
          const mid = (lo + hi) / 2;
          if (fits(mid)) lo = mid;
          else hi = mid;
        }
        const scale = fits(1) ? 1 : lo;
        if (size * scale >= (options.minSize ?? Math.min(size, 16))) {
          const candidate = rectangle(anchor.x + offset[0], anchor.y + offset[1], scale);
          if (vacant(candidate)) {
            box = candidate;
            element.style.fontSize = `${size * scale}px`;
          }
        }
      }
      // A complete, readable number remains attached to its face even when it cannot fit inside.
      const faceBox = polygon && {
        left: Math.min(...polygon.map((p) => p.x)),
        right: Math.max(...polygon.map((p) => p.x)),
        top: Math.min(...polygon.map((p) => p.y)),
        bottom: Math.max(...polygon.map((p) => p.y)),
      };
      const candidates = faceBox
        ? [
            [0, faceBox.top - anchor.y - high - 12],
            [0, faceBox.bottom - anchor.y + high + 12],
            [faceBox.left - anchor.x - half - 12, 0],
            [faceBox.right - anchor.x + half + 12, 0],
          ]
        : [
            [0, 0],
            [0, -high * 2 - 8],
            [0, high * 2 + 8],
            [0, -high * 4 - 16],
            [0, high * 4 + 16],
            [-half * 2 - 12, 0],
            [half * 2 + 12, 0],
          ];
      if (!box)
        for (const [dx, dy] of candidates) {
          const candidate = rectangle(
            Math.max(half + 8, Math.min(width - half - 8, anchor.x + offset[0] + dx!)),
            Math.max(high + 8, Math.min(height - high - 8, anchor.y + offset[1] + dy!)),
          );
          if (
            faceBox &&
            !(
              candidate.right < faceBox.left ||
              candidate.left > faceBox.right ||
              candidate.bottom < faceBox.top ||
              candidate.top > faceBox.bottom
            )
          )
            continue;
          if (vacant(candidate)) {
            box = candidate;
            break;
          }
        }
      element.hidden = !box;
      if (!box) {
        element.dataset.layoutError = `No readable space for label "${element.textContent}". Widen this shot or show fewer labels.`;
        continue;
      }
      placed.push(box);
      element.style.left = `${box.x}px`;
      element.style.top = `${box.y}px`;
      const end = {
        x: Math.max(box.left, Math.min(box.right, anchor.x)),
        y: Math.max(box.top, Math.min(box.bottom, anchor.y)),
      };
      if (Math.hypot(end.x - anchor.x, end.y - anchor.y) > 10) {
        leader.setAttribute('d', `M${anchor.x} ${anchor.y}L${end.x} ${end.y}`);
        leader.style.display = '';
      }
    }
  }
  return {
    render,
    label(text: string | (() => string), anchor: Anchor, options: LabelOptions = {}) {
      if (options.face && !(anchor instanceof T.Mesh))
        throw new Error('A face label needs a Mesh anchor');
      const element = document.createElement('span');
      element.className = 've-label';
      element.dataset.tone = options.tone ?? 'ink';
      element.textContent = typeof text === 'function' ? text() : text;
      stage.append(element);
      const leader = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      leader.setAttribute('fill', 'none');
      leader.setAttribute('stroke', 'var(--ve-pencil)');
      leader.setAttribute('stroke-width', '1');
      leaders.append(leader);
      const item = { element, leader, text, anchor, options };
      labels.add(item);
      invalidate();
      return {
        element,
        remove() {
          labels.delete(item);
          element.remove();
          leader.remove();
        },
      };
    },
    dispose() {
      for (const item of labels) item.element.remove();
      labels.clear();
      leaders.remove();
    },
  };
}
