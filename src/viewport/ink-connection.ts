import * as T from './engine.js';
import type { Camera } from 'three';
import {
  connectionRoute,
  type ConnectionBounds,
  type ConnectionSide,
} from '../layout/connection.js';
import { geometryFrameAnchors } from './framing.js';
import { InkStroke3D, type InkStrokeOptions } from './ink-line.js';
import { objectVisible, drawsGeometry } from './visibility.js';
import type { Viewport3DHandle } from './three.js';

/** Physical labels expose their own synchronous measurement; screen annotations have no plane. */
export type ConnectionTarget3D =
  | T.Object3D
  | {
      object: T.Object3D;
      update(camera: Camera): void;
    };
export interface InkConnectionOptions extends InkStrokeOptions {
  /** One diagram plane; its local +y points up. The connection is attached here. */
  space: T.Object3D;
  avoid?: readonly ConnectionTarget3D[];
  gap?: number;
  clearance?: number;
  fromSide?: ConnectionSide;
  toSide?: ConnectionSide;
  depth?: number;
  arrow?: boolean;
  headSize?: number;
}

/** A line, its arrow and any travelling signal share one measured path on the diagram plane. */
function create(
  view: Viewport3DHandle,
  from: ConnectionTarget3D,
  to: ConnectionTarget3D,
  options: InkConnectionOptions,
) {
  const { space, depth = 0.06, headSize = 0.16, arrow = true } = options;
  if (!Number.isFinite(depth) || !Number.isFinite(headSize) || headSize <= 0)
    throw new Error('A connection needs finite depth and a positive arrow size');
  const root = new T.Group(),
    line = InkStroke3D.create(view, [], options),
    head = arrow ? InkStroke3D.create(view, [], { ...options, dashed: false }) : undefined;
  root.add(line.root);
  if (head) root.add(head.root);
  let progress = 1,
    length = 0,
    signature = '',
    currentAvoid = options.avoid ?? [],
    current: readonly (readonly [number, number, number])[] = [];
  function drawHead() {
    if (!head) return;
    const tip = line.pointAt(progress),
      tangent = line.tangentAt(progress);
    if (!tip || !tangent || progress <= 0 || length === 0) head.points([]);
    else {
      const angle = Math.atan2(tangent[1], tangent[0]),
        size = Math.min(headSize, length * progress * 0.7);
      head.points([
        [tip[0] - size * Math.cos(angle - 0.45), tip[1] - size * Math.sin(angle - 0.45), depth],
        tip,
        [tip[0] - size * Math.cos(angle + 0.45), tip[1] - size * Math.sin(angle + 0.45), depth],
      ]);
    }
    // Writing the tip must not make the framing breathe with the drawing progress.
    head.root.geometry.boundingBox = line.root.geometry
      .boundingBox!.clone()
      .expandByScalar(headSize);
    head.root.geometry.boundingSphere = head.root.geometry.boundingBox.getBoundingSphere(
      new T.Sphere(),
    );
  }
  function update(
    targets: {
      from?: ConnectionTarget3D;
      to?: ConnectionTarget3D;
      avoid?: readonly ConnectionTarget3D[];
    } = {},
  ) {
    const nextFrom = targets.from ?? from,
      nextTo = targets.to ?? to,
      avoid = targets.avoid ?? currentAvoid;
    space.updateWorldMatrix(true, false);
    const inverse = space.matrixWorld.clone().invert();
    const measured = new Map<T.Object3D, ConnectionBounds | undefined>();
    const objectOf = (target: ConnectionTarget3D) => ('object' in target ? target.object : target);
    for (const target of [nextFrom, nextTo, ...avoid])
      if ('object' in target) target.update(view.camera);
    function measure(target: ConnectionTarget3D) {
      const object = objectOf(target);
      if (measured.has(object)) return measured.get(object);
      let bounds: ConnectionBounds | undefined;
      if (objectVisible(object)) {
        const box = new T.Box3();
        for (const anchor of geometryFrameAnchors([object], drawsGeometry))
          if (anchor.position.toArray().every(Number.isFinite))
            box.expandByPoint(anchor.position.applyMatrix4(inverse));
        if (!box.isEmpty())
          bounds = {
            x: box.min.x,
            y: -box.max.y,
            width: box.max.x - box.min.x,
            height: box.max.y - box.min.y,
          };
      }
      measured.set(object, bounds);
      return bounds;
    }
    const a = measure(nextFrom),
      b = measure(nextTo),
      obstacles = [
        ...new Set(
          avoid
            .map(measure)
            .filter(
              (bounds): bounds is ConnectionBounds => !!bounds && bounds !== a && bounds !== b,
            ),
        ),
      ];
    const key = JSON.stringify([a, b, obstacles]);
    if (key !== signature) {
      const route =
        a && b
          ? connectionRoute(a, b, {
              gap: options.gap ?? 0.08,
              clearance: options.clearance ?? 0.18,
              fromSide: options.fromSide,
              toSide: options.toSide,
              avoid: obstacles,
            })
          : undefined;
      // Publish only after routing succeeds. A bad placement cannot leave a half-updated path.
      current = route?.points.map((p) => [p.x, -p.y, depth] as const) ?? [];
      length = current
        .slice(1)
        .reduce((sum, p, i) => sum + Math.hypot(p[0] - current[i]![0], p[1] - current[i]![1]), 0);
      line.points(current);
      drawHead();
      line.root.visible = !!route;
      if (head) head.root.visible = !!route;
      signature = key;
    }
    from = nextFrom;
    to = nextTo;
    currentAvoid = avoid;
  }
  space.add(root);
  try {
    update();
  } catch (error) {
    root.removeFromParent();
    for (const stroke of [line, head]) {
      stroke?.root.geometry.dispose();
      stroke?.root.material.dispose();
    }
    throw error;
  }
  return {
    root,
    /** Call after placement or text edits. Hidden obstacles are excluded; no second clock runs. */
    update,
    pointAt: line.pointAt,
    tangentAt: line.tangentAt,
    get route() {
      return current;
    },
    draw(next: number) {
      line.draw(next);
      progress = Math.max(0, Math.min(1, next));
      drawHead();
    },
  };
}
export const InkConnection3D = { create };
