import R from '@dimforge/rapier2d-compat';
import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { Pigment } from '../ink/palette.js';
import type { Surface } from '../ink/surface.js';
import { positive } from './materials.js';
import { pointerGrab } from './grab.js';
import { deformableGrip } from './deformable-grip.js';
import type { World2D, Body2D, BodyOptions2D } from './world2d.js';

const owners = new WeakSet<Surface>();
/** SVG drawing and collider share one shape. Units are metres; scale is pixels/metre. */
export function physicalInk(world: World2D, view: Surface, { scale = 80 } = {}) {
  positive(scale, 'Drawing scale');
  if (world.disposed) throw new Error('Physics world has been disposed');
  if (owners.has(view)) throw new Error('A drawing surface can have only one physics binding');
  let disposed = false;
  const offView = view.onDispose(dispose);
  owners.add(view);
  const bindings = new Map<string, Body2D>();
  const cleanups = new Set<() => void>();
  const fromPointer = (event: PointerEvent) => {
    const matrix = view.layer.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return { x: p.x / scale, y: p.y / scale };
  };
  const grab = pointerGrab(
    view.element,
    (event) => {
      const id = (event.target as Element)
        .closest('[data-physical-body]')
        ?.getAttribute('data-physical-body');
      const body = id ? bindings.get(id) : undefined;
      return body?.fixed ? undefined : body;
    },
    (body, event) => {
      let point = fromPointer(event);
      const soft = body.soft;
      if (soft) {
        const release = deformableGrip(world, soft, () => point);
        const off = body.onDispose(grab.release);
        return {
          move(e) {
            point = fromPointer(e);
            world.wake();
          },
          release() {
            off();
            release();
          },
        };
      }
      const cursor = world.raw.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased().setTranslation(point.x, point.y),
      );
      const p = body.rigid.translation(),
        a = -body.rigid.rotation();
      const dx = point.x - p.x,
        dy = point.y - p.y;
      const anchor = {
        x: dx * Math.cos(a) - dy * Math.sin(a),
        y: dx * Math.sin(a) + dy * Math.cos(a),
      };
      const mass = body.rigid.mass();
      const joint = world.raw.createImpulseJoint(
        R.JointData.spring(0, mass * 600, mass * 35, anchor, { x: 0, y: 0 }),
        body.rigid,
        cursor,
        true,
      );
      const stop = world.beforeStep(() => cursor.setNextKinematicTranslation(point));
      const off = body.onDispose(grab.release);
      world.wake();
      return {
        move(e) {
          point = fromPointer(e);
          world.wake();
        },
        release() {
          off();
          stop();
          world.raw.removeImpulseJoint(joint, true);
          world.raw.removeRigidBody(cursor);
        },
      };
    },
  );
  function body(
    id: string,
    options: BodyOptions2D & { pigment?: Pigment; label?: string; draggable?: boolean },
  ) {
    if (disposed) throw new Error('Physical ink binding has been disposed');
    const physical = world.body(id, options);
    const mark = object(view.layer, `physics-${id}`, options.pigment ?? 'blue');
    if (!physical.fixed && options.draggable !== false) {
      mark.element.dataset.physicalBody = id;
      mark.element.style.cssText = 'cursor:grab;touch-action:none';
      bindings.set(id, physical);
      mark.element.setAttribute('tabindex', '0');
      mark.element.setAttribute('role', 'button');
      mark.element.setAttribute(
        'aria-label',
        `${options.label ?? id}. Перетаскивайте или толкайте стрелками`,
      );
    }
    const keys = (event: KeyboardEvent) => {
      const pushes: Record<string, readonly [number, number]> = {
        ArrowLeft: [-0.5, 0],
        ArrowRight: [0.5, 0],
        ArrowUp: [0, -0.8],
        ArrowDown: [0, 0.5],
      };
      if (physical.fixed || options.draggable === false || !pushes[event.key]) return;
      event.preventDefault();
      physical.impulse(pushes[event.key]!);
    };
    mark.element.addEventListener('keydown', keys);
    const shape = options.shape;
    let path: string;
    if ('circle' in shape) {
      const r = shape.circle * scale;
      path = `M${-r} 0 A${r} ${r} 0 1 0 ${r} 0 A${r} ${r} 0 1 0 ${-r} 0 Z`;
    } else if ('box' in shape) {
      const [w, h] = shape.box.map((n) => n * scale) as [number, number];
      path = `M${-w / 2} ${-h / 2} h${w} v${h} h${-w} Z`;
    } else
      path =
        shape.polygon.map(([x, y], i) => `${i ? 'L' : 'M'}${x * scale} ${y * scale}`).join(' ') +
        ' Z';
    const drawing = view.pen.path(mark.content, `physics-${id}:surface`, path, { fill: 'marker' });
    const label =
      options.label === undefined
        ? undefined
        : lettering(mark.content, options.label, { y: 6, size: 22 });
    let previous = '';
    const stop = world.onRender(() => {
      const [x, y] = physical.position;
      mark.at(
        x * scale,
        y * scale,
        physical.soft ? 0 : (physical.rigid.rotation() * 180) / Math.PI,
      );
      const soft = physical.soft;
      if (!soft) return;
      const vertices = soft.particlePositions(),
        edges = soft.boundary();
      const next = new Map<number, number>();
      for (let i = 0; i < edges.length; i += 2) next.set(edges[i]!, edges[i + 1]!);
      const ring: [number, number][] = [];
      let at = edges[0]!;
      for (let i = 0; i < next.size; i++) {
        ring.push([(vertices[at * 2]! - x) * scale, (vertices[at * 2 + 1]! - y) * scale]);
        at = next.get(at)!;
      }
      if (!ring.length) return;
      let d: string;
      if ('circle' in shape) {
        const middle = (a: number, b: number) =>
          [(ring[a]![0] + ring[b]![0]) / 2, (ring[a]![1] + ring[b]![1]) / 2].join(' ');
        d =
          `M${middle(ring.length - 1, 0)} ` +
          ring.map((p, i) => `Q${p.join(' ')} ${middle(i, (i + 1) % ring.length)}`).join(' ') +
          ' Z';
      } else d = ring.map((p, i) => `${i ? 'L' : 'M'}${p.join(' ')}`).join(' ') + ' Z';
      if (d === previous) return;
      previous = d;
      const xs = ring.map((p) => p[0]),
        ys = ring.map((p) => p[1]);
      const minX = Math.min(...xs),
        minY = Math.min(...ys);
      drawing.update(d, {
        x: minX,
        y: minY,
        width: Math.max(...xs) - minX,
        height: Math.max(...ys) - minY,
      });
    });
    physical.onDispose(cleanup);
    function cleanup() {
      stop();
      bindings.delete(id);
      mark.element.removeEventListener('keydown', keys);
      label?.dispose();
      drawing.dispose();
      mark.dispose();
      cleanups.delete(physical.dispose);
    }
    cleanups.add(physical.dispose);
    return Object.assign(physical, { mark, label });
  }
  const off = world.onDispose(dispose);
  const stopCheckpoint = world.beforeCheckpoint(grab.release);
  function dispose() {
    if (disposed) return;
    disposed = true;
    owners.delete(view);
    grab.dispose();
    for (const cleanup of [...cleanups]) cleanup();
    off();
    offView();
    stopCheckpoint();
  }
  return { body, dispose };
}
