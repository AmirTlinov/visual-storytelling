import * as T from './engine.js';
import type { Camera } from 'three';
import { annotation, type LabelFrame } from './label-annotation.js';
import { surfaceLettering, type SurfaceOptions, type LabelAnchor } from './surface-lettering.js';
import type { FrameAnchor } from './framing.js';
export type { Face } from './label-faces.js';

export interface LabelOptions extends SurfaceOptions {
  offset?: [number, number];
  size?: number;
  frame?: LabelFrame;
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
function belongs(anchor: LabelAnchor, roots: readonly T.Object3D[]) {
  if (typeof anchor === 'function') return false;
  for (let node: T.Object3D | null = anchor; node; node = node.parent)
    if (roots.includes(node)) return true;
  return false;
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
  function measure(items: Iterable<ScreenLabel>) {
    const pending = [...items].flatMap((item) => {
      const { annotation: a, options } = item;
      if (typeof item.text === 'function') {
        const text = item.text();
        if (a.element.textContent !== text) a.element.textContent = text;
      }
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
      return [{ item, point }];
    });
    // Write every label first, then measure; framing and painting share these dimensions.
    return pending.map((p) => ({
      ...p,
      size: p.item.annotation.frameSize(
        p.item.annotation.element.scrollWidth,
        p.item.annotation.element.offsetHeight,
      ),
    }));
  }
  function render() {
    for (const item of surfaces) item.update(camera);
    const width = stage.clientWidth,
      height = stage.clientHeight,
      safe = insets();
    // Each label keeps its authored anchor. Orbit never triggers packing or a callout.
    for (const { point, item, size } of measure(labels)) {
      const [w, h] = size as [number, number],
        a = item.annotation;
      const p = point.clone().project(camera);
      if (p.z < -1 || p.z > 1) {
        a.hidden(true);
        continue;
      }
      const offset = item.options.offset ?? [0, 0];
      const x = ((p.x + 1) * width) / 2 + offset[0],
        y = ((1 - p.y) * height) / 2 + offset[1];
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
    anchors(target: T.Object3D | T.Box3 | readonly T.Object3D[]): FrameAnchor[] {
      if (target instanceof T.Box3) return [];
      const roots = Array.isArray(target) ? target : [target];
      return measure([...labels].filter((item) => belongs(item.anchor, roots))).map(
        ({ item, point, size }) => ({
          position: point,
          padding: [
            size[0]! / 2 + Math.abs(item.options.offset?.[0] ?? 0),
            size[1]! / 2 + Math.abs(item.options.offset?.[1] ?? 0),
          ],
        }),
      );
    },
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
    dispose(root?: T.Object3D) {
      for (const item of labels)
        if (!root || belongs(item.anchor, [root])) {
          item.annotation.remove();
          labels.delete(item);
        }
      for (const item of surfaces)
        if (!root || belongs(item.object, [root])) {
          item.remove();
          surfaces.delete(item);
        }
    },
  };
}
