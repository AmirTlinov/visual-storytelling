import * as T from './engine.js';
import type { Camera } from 'three';
import { annotation, annotationMask, type LabelFrame } from './label-annotation.js';
import { surfaceLettering, type SurfaceOptions } from './surface-lettering.js';
import { resolveLabelAnchor, type LabelAnchor } from './label-anchor.js';
import { geometryFrameAnchors, type FrameAnchor } from './framing.js';
import { placeLabels, type LabelBox, type LabelPlacement } from '../layout/labels.js';
import { labelOverflow } from '../layout/label-overflow.js';
import { drawsGeometry, objectVisible, objectWithin } from './visibility.js';
import { subjectOf } from './semantics.js';
import { describeObject } from '../scene-objects.js';
export type { Face } from './label-faces.js';

export interface LabelOptions extends SurfaceOptions {
  offset?: [number, number];
  size?: number;
  frame?: LabelFrame;
  /** Screen annotations pack by default. False pins the label and reserves its exact footprint. */
  avoidOverlap?: boolean;
  /** Prepared vertical order for a related set of moving annotations. */
  order?: number;
  /** Higher priorities retain their place first when the safe area is crowded. */
  priority?: number;
}
export interface LabelInsets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}
type ScreenLabel = {
  index: number;
  annotation: ReturnType<typeof annotation>;
  text: string | (() => string);
  anchor: ReturnType<typeof resolveLabelAnchor>;
  options: LabelOptions;
  opacity: number;
  subject?: ReturnType<typeof subjectOf>;
  forget?: () => void;
};
type Surface = ReturnType<typeof surfaceLettering>;
const belongs = (object: T.Object3D | undefined, roots: readonly T.Object3D[]) =>
  object !== undefined && roots.some((root) => objectWithin(object, root));

/** Stable annotations and physical inscriptions have explicit, separate spatial roles. */
export function projectedLabels(
  stage: HTMLElement,
  camera: Camera,
  scene: T.Scene,
  ink: (material: T.MeshBasicMaterial, tone: string) => T.MeshBasicMaterial,
  release: (object: T.Object3D) => void,
  invalidate: () => void,
  insets: () => LabelInsets = () => ({}),
  obstacles: () => readonly (T.Object3D | T.Box3)[] = () => [],
) {
  const labels = new Set<ScreenLabel>(),
    surfaces = new Set<Surface>(),
    overflow = labelOverflow(stage),
    mask = annotationMask(stage);
  let nextIndex = 0;
  function measure(items: Iterable<ScreenLabel>, reserveHidden = false) {
    const restore: (() => void)[] = [];
    try {
      const pending = [...items].flatMap((item) => {
        const { annotation: a, options } = item;
        if (reserveHidden) {
          const groupHidden = a.group.hidden,
            textHidden = a.element.hidden,
            visibility = a.group.style.visibility,
            opacity = a.group.style.opacity;
          // Removing display:none makes wrapping measurable; visibility suppresses any paint.
          a.group.style.visibility = 'hidden';
          restore.push(() => {
            a.group.hidden = groupHidden;
            a.element.hidden = textHidden;
            a.group.style.opacity = opacity;
            a.group.style.visibility = visibility;
          });
        }
        const owner = item.anchor.object;
        const subject = owner && subjectOf(owner);
        if (subject !== item.subject) {
          item.forget?.();
          item.forget = undefined;
          item.subject = subject;
          if (subject) {
            a.element.dataset.object = subject.id;
            item.forget = describeObject(a.element, subject.meaning);
            // Keyboard traversal has one target per object, owned by the viewport.
            a.element.tabIndex = -1;
            a.element.style.pointerEvents = 'auto';
          } else {
            for (const name of [
              'data-object',
              'role',
              'tabindex',
              'aria-label',
              'aria-pressed',
              'data-selected',
            ])
              a.element.removeAttribute(name);
            a.element.style.pointerEvents = '';
          }
        }
        if (typeof item.text === 'function') {
          const text = item.text();
          if (a.element.textContent !== text) a.element.textContent = text;
        }
        a.group.hidden = a.element.hidden = false;
        const font = options.size ? `${options.size}px` : '';
        if (a.element.style.fontSize !== font) a.element.style.fontSize = font;
        const safe = insets(),
          padding = options.frame?.padding?.[0] ?? (options.frame ? 13 : 0);
        a.element.style.maxWidth = `${Math.max(1, Math.min(options.maxWidth ?? 320, stage.clientWidth - (safe.left ?? 0) - (safe.right ?? 0) - padding * 2 - 8))}px`;
        a.element.style.whiteSpace = 'pre-line';
        a.element.style.overflowWrap = 'anywhere';
        a.element.style.textAlign = 'center';
        if (
          !a.element.textContent ||
          (owner && !objectWithin(owner, scene)) ||
          (!reserveHidden &&
            ((owner && !objectVisible(owner)) ||
              options.visible?.() === false ||
              item.opacity <= 0))
        ) {
          a.opacity(0);
          a.hidden(true);
          delete a.group.dataset.layoutStatus;
          return [];
        }
        return [{ item, point: item.anchor.world() }];
      });
      // Write every label first, then measure; framing and painting share these dimensions.
      return pending.map((p) => ({
        ...p,
        size: p.item.annotation.frameSize(
          p.item.annotation.element.scrollWidth,
          p.item.annotation.element.offsetHeight,
        ),
      }));
    } finally {
      restore.forEach((reset) => reset());
    }
  }
  function render() {
    for (const item of surfaces) item.update(camera);
    const width = stage.clientWidth,
      height = stage.clientHeight,
      safe = insets(),
      area: LabelBox = {
        x: (safe.left ?? 0) + 4,
        y: (safe.top ?? 0) + 4,
        width: Math.max(1, width - (safe.left ?? 0) - (safe.right ?? 0) - 8),
        height: Math.max(1, height - (safe.top ?? 0) - (safe.bottom ?? 0) - 8),
      };
    const projectedBox = (points: readonly FrameAnchor[]): LabelBox[] => {
      const projected = points.map(({ position }) => position.clone().project(camera));
      if (
        !projected.length ||
        projected.some((p) => ![p.x, p.y, p.z].every(Number.isFinite)) ||
        projected.every((p) => p.z < -1 || p.z > 1)
      )
        return [];
      const xs = projected.map((p) => ((p.x + 1) * width) / 2),
        ys = projected.map((p) => ((1 - p.y) * height) / 2);
      const x = Math.min(...xs),
        y = Math.min(...ys);
      return [{ x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }];
    };
    const protectedSpace = obstacles().flatMap((target) => {
      if (!(target instanceof T.Box3))
        return objectWithin(target, scene) && objectVisible(target)
          ? projectedBox(geometryFrameAnchors([target], drawsGeometry))
          : [];
      const points: FrameAnchor[] = [];
      if (!target.isEmpty())
        for (const x of [target.min.x, target.max.x])
          for (const y of [target.min.y, target.max.y])
            for (const z of [target.min.z, target.max.z])
              points.push({ position: new T.Vector3(x, y, z) });
      return projectedBox(points);
    });
    const eye = camera.getWorldPosition(new T.Vector3());
    for (const surface of surfaces)
      if (!surface.element.hidden) {
        for (const plane of surface.object.children) {
          const normal = new T.Vector3(0, 0, 1).transformDirection(plane.matrixWorld);
          if (normal.dot(eye.clone().sub(plane.getWorldPosition(new T.Vector3()))) <= 0) continue;
          protectedSpace.push(...projectedBox(geometryFrameAnchors([plane], drawsGeometry)));
        }
      }
    const candidates = measure(labels).flatMap(({ point, item, size }) => {
      const p = point.clone().project(camera);
      if (![p.x, p.y, p.z].every(Number.isFinite) || p.z < -1 || p.z > 1) {
        item.annotation.hidden(true);
        delete item.annotation.group.dataset.layoutStatus;
        return [];
      }
      const offset = item.options.offset ?? [0, 0];
      return [
        {
          item,
          size,
          anchor: [((p.x + 1) * width) / 2, ((1 - p.y) * height) / 2] as const,
          x: ((p.x + 1) * width) / 2 + offset[0],
          y: ((1 - p.y) * height) / 2 + offset[1],
        },
      ];
    });
    const stable = [...candidates].sort(
      (a, b) =>
        (a.item.options.order ?? a.item.index) - (b.item.options.order ?? b.item.index) ||
        a.item.index - b.item.index,
    );
    const box = (p: (typeof candidates)[number]): LabelBox => ({
      x: p.x - p.size[0]! / 2,
      y: p.y - p.size[1]! / 2,
      width: p.size[0]!,
      height: p.size[1]!,
      opacity: p.item.opacity,
      priority: p.item.options.priority,
    });
    const arrange = (protectedAreas: readonly LabelBox[]) => {
      const placements = new Map<ScreenLabel, LabelPlacement>(),
        reserved = [...protectedAreas];
      for (const p of stable)
        if (p.item.options.avoidOverlap === false) {
          const bounds = box(p),
            placement = placeLabels([bounds], area, {
              obstacles: reserved,
              limits: [
                {
                  left: bounds.x,
                  right: bounds.x + bounds.width,
                  top: bounds.y,
                  bottom: bounds.y + bounds.height,
                },
              ],
            })[0]!;
          placements.set(p.item, placement);
          if (placement.status === 'placed') reserved.push(placement);
        }
      const automatic = stable.filter((p) => p.item.options.avoidOverlap !== false),
        placed = placeLabels(automatic.map(box), area, { obstacles: reserved });
      automatic.forEach((p, index) => placements.set(p.item, placed[index]!));
      return placements;
    };
    let arranged = arrange(protectedSpace),
      control = overflow.preferred(area);
    if (stable.some((p) => arranged.get(p.item)?.status === 'overflow')) {
      const position = placeLabels([control], area, { obstacles: protectedSpace })[0]!;
      if (position.status === 'placed') control = position;
      arranged = arrange([...protectedSpace, control]);
    }
    const missing: Parameters<typeof overflow.update>[0][number][] = [];
    for (const { item, size, x, y, anchor } of candidates) {
      const [w, h] = size as [number, number],
        a = item.annotation,
        position = arranged.get(item)!;
      a.group.dataset.layoutStatus = position.status;
      if (position.status === 'overflow') {
        missing.push({
          id: String(item.index),
          label: a.element.textContent ?? '',
          subject: item.subject?.meaning.label,
        });
        a.hidden(true);
        continue;
      }
      const centerX = position.x + w / 2,
        centerY = position.y + h / 2;
      a.place(
        centerX,
        centerY,
        w,
        h,
        Math.hypot(centerX - x, centerY - y) > 1 ? anchor : undefined,
      );
      a.opacity(item.opacity);
      a.hidden(false);
    }
    overflow.update(missing, control);
    mask.update(
      [
        ...protectedSpace,
        ...[...arranged.values()].filter((p) => p.status === 'placed'),
        ...(missing.length ? [control] : []),
      ],
      width,
      height,
    );
  }
  return {
    render,
    anchors(
      target: T.Object3D | T.Box3 | readonly T.Object3D[],
      reserveHidden = false,
    ): FrameAnchor[] {
      if (target instanceof T.Box3) return [];
      const roots = Array.isArray(target) ? target : [target];
      // A shot can follow a text or local-position change before the next render.
      for (const item of surfaces) if (belongs(item.object, roots)) item.prepare();
      return measure(
        [...labels].filter((item) => belongs(item.anchor.object, roots)),
        reserveHidden,
      ).map(({ item, point, size }) => ({
        position: point,
        padding: [
          size[0]! / 2 + Math.abs(item.options.offset?.[0] ?? 0),
          size[1]! / 2 + Math.abs(item.options.offset?.[1] ?? 0),
        ],
      }));
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
        const { prepare: _prepare, ...label } = item;
        return {
          ...label,
          remove() {
            surfaces.delete(item);
            item.remove();
          },
        };
      }
      const a = annotation(stage, options.tone ?? 'ink', options.frame, mask.id);
      a.element.textContent = typeof text === 'function' ? text() : text;
      const item: ScreenLabel = {
        index: nextIndex++,
        annotation: a,
        text,
        anchor: resolveLabelAnchor(anchor),
        options,
        opacity: 1,
      };
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
          item.forget?.();
          a.remove();
          invalidate();
        },
      };
    },
    dispose(root?: T.Object3D) {
      if (!root) {
        overflow.dispose();
        mask.dispose();
      }
      for (const item of labels)
        if (!root || belongs(item.anchor.object, [root])) {
          item.forget?.();
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
