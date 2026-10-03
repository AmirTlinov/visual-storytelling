import * as T from './engine.js';
import type { Camera } from 'three';
import { annotation, type LabelFrame } from './label-annotation.js';
import { surfaceLettering, type SurfaceOptions, type LabelAnchor } from './surface-lettering.js';
export type { Face } from './label-faces.js';

export interface LabelOptions extends SurfaceOptions {
  offset?: [number, number];
  size?: number;
  frame?: LabelFrame;
  /** A stable side of the projected object, with no collision-driven reassignment. */
  side?: 'top' | 'bottom' | 'left' | 'right';
  gap?: number;
}
export interface LabelInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}
type ScreenLabel = {
  annotation: ReturnType<typeof annotation>;
  text: string | (() => string);
  anchor: LabelAnchor;
  options: LabelOptions;
  opacity: number;
};
type Surface = ReturnType<typeof surfaceLettering>;
function visible(anchor: LabelAnchor) {
  if (typeof anchor === 'function') return true;
  for (let node: T.Object3D | null = anchor; node; node = node.parent)
    if (!node.visible) return false;
  return true;
}

/** Stable annotations and physical inscriptions have explicit, separate spatial roles. */
export function projectedLabels(
  stage: HTMLElement,
  camera: Camera,
  scene: T.Scene,
  ink: (material: T.MeshBasicMaterial, tone: string) => T.MeshBasicMaterial,
  release: (object: T.Object3D) => void,
  invalidate: () => void,
  insets: () => LabelInsets = () => ({}),
) {
  const labels = new Set<ScreenLabel>(),
    surfaces = new Set<Surface>();
  function render() {
    for (const item of surfaces) item.update(camera);
    const width = stage.clientWidth,
      height = stage.clientHeight,
      safe = insets();
    const pending = [...labels].flatMap((item) => {
      const { annotation: a, options } = item;
      if (typeof item.text === 'function') a.element.textContent = item.text();
      a.hidden(false);
      const font = options.size ? `${options.size}px` : '';
      if (a.element.style.fontSize !== font) a.element.style.fontSize = font;
      if (
        !a.element.textContent ||
        !visible(item.anchor) ||
        options.visible?.() === false ||
        item.opacity <= 0
      ) {
        a.hidden(true);
        return [];
      }
      const point =
        typeof item.anchor === 'function'
          ? item.anchor()
          : item.anchor.getWorldPosition(new T.Vector3());
      const p = point.clone().project(camera);
      if (p.z < -1 || p.z > 1) {
        a.hidden(true);
        return [];
      }
      let bounds;
      if (options.side && typeof item.anchor !== 'function') {
        const box = new T.Box3().setFromObject(item.anchor);
        if (!box.isEmpty()) {
          const points = [box.min.x, box.max.x].flatMap((x) =>
            [box.min.y, box.max.y].flatMap((y) =>
              [box.min.z, box.max.z].map((z) => new T.Vector3(x, y, z).project(camera)),
            ),
          );
          bounds = {
            left: Math.min(...points.map((p) => ((p.x + 1) * width) / 2)),
            right: Math.max(...points.map((p) => ((p.x + 1) * width) / 2)),
            top: Math.min(...points.map((p) => ((1 - p.y) * height) / 2)),
            bottom: Math.max(...points.map((p) => ((1 - p.y) * height) / 2)),
          };
        }
      }
      const offset = options.offset ?? [0, 0];
      return [
        {
          item,
          bounds,
          x: ((p.x + 1) * width) / 2 + offset[0],
          y: ((1 - p.y) * height) / 2 + offset[1],
        },
      ];
    });
    // Each label keeps its authored anchor. Orbit never triggers packing or a callout.
    const measured = pending.map((p) => ({
      ...p,
      size: p.item.annotation.frameSize(
        p.item.annotation.element.scrollWidth,
        p.item.annotation.element.offsetHeight,
      ),
    }));
    for (const measurement of measured) {
      let { x, y } = measurement;
      const { item, size, bounds } = measurement;
      const [w, h] = size as [number, number],
        a = item.annotation;
      if (bounds) {
        const gap = item.options.gap ?? 12,
          side = item.options.side;
        x = (bounds.left + bounds.right) / 2;
        y = (bounds.top + bounds.bottom) / 2;
        if (side === 'top') y = bounds.top - h / 2 - gap;
        if (side === 'bottom') y = bounds.bottom + h / 2 + gap;
        if (side === 'left') x = bounds.left - w / 2 - gap;
        if (side === 'right') x = bounds.right + w / 2 + gap;
      }
      a.place(x, y, w, h);
      // Fade at UI edges without clamping a label away from its owner.
      const room = Math.min(
        x - w / 2 - (safe.left ?? 0),
        width - (safe.right ?? 0) - x - w / 2,
        y - h / 2 - (safe.top ?? 0),
        height - (safe.bottom ?? 0) - y - h / 2,
      );
      a.group.style.opacity = String(item.opacity * Math.max(0, Math.min(1, (room + 8) / 16)));
      a.hidden(room <= -8);
    }
  }
  return {
    render,
    label(text: string | (() => string), anchor: LabelAnchor, options: LabelOptions = {}) {
      if (options.face || options.space === 'world') {
        if (options.frame)
          throw new Error(
            'Use a screen annotation for framed explanations; physical outlines belong to the object.',
          );
        const item = surfaceLettering(
          stage,
          scene,
          text,
          anchor,
          options,
          ink,
          release,
          invalidate,
        );
        surfaces.add(item);
        invalidate();
        return {
          ...item,
          remove() {
            surfaces.delete(item);
            item.remove();
          },
        };
      }
      const a = annotation(stage, options.tone ?? 'ink', options.frame);
      a.element.textContent = typeof text === 'function' ? text() : text;
      const item: ScreenLabel = { annotation: a, text, anchor, options, opacity: 1 };
      labels.add(item);
      invalidate();
      return {
        element: a.element,
        set(value: string) {
          item.text = value;
          a.element.textContent = value;
          invalidate();
        },
        show(value: boolean) {
          options.visible = () => value;
          invalidate();
        },
        opacity(value: number) {
          item.opacity = value;
          invalidate();
        },
        remove() {
          labels.delete(item);
          a.remove();
          invalidate();
        },
      };
    },
    dispose() {
      for (const item of labels) item.annotation.remove();
      labels.clear();
      for (const item of surfaces) item.remove();
      surfaces.clear();
    },
  };
}
