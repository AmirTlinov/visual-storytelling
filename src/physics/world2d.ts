import R from '@dimforge/rapier2d-compat';
import { physicsRuntime } from './runtime.js';
import { bodyLifetime } from './body.js';
import { springSettings, springLifetime, type SpringOptions } from './spring.js';
import { coordinates, material, positive, type MaterialChoice } from './materials.js';

export type Vec2 = readonly [number, number];
export type Shape2D = { circle: number } | { box: Vec2 } | { polygon: readonly Vec2[] };
export interface BodyOptions2D {
  shape: Shape2D;
  at?: Vec2;
  material?: MaterialChoice;
  mass?: number;
  fixed?: boolean;
}
export interface Body2D {
  readonly id: string;
  readonly world: ReturnType<typeof physicsRuntime<R.World>>;
  readonly shape: Shape2D;
  readonly fixed: boolean;
  readonly disposed: boolean;
  onDispose(cleanup: () => void): () => void;
  readonly rigid: R.RigidBody;
  readonly soft: R.SoftBody | undefined;
  readonly position: Vec2;
  impulse(value: Vec2): void;
  dispose(): void;
}
let ready: Promise<void> | undefined;
const vector = (p: Vec2) => {
  coordinates(p, 2);
  return { x: p[0], y: p[1] };
};

export async function world2D({ gravity = [0, 9.81] as Vec2 } = {}) {
  await (ready ??= R.init());
  const runtime = physicsRuntime(new R.World(vector(gravity)), R.World.restoreSnapshot);
  function body(id: string, options: BodyOptions2D): Body2D {
    runtime.reserve(id);
    const at = vector(options.at ?? [0, 0]),
      m = material(options.material);
    const mass = positive(options.mass ?? 1, 'Mass');
    let collider: R.ColliderDesc | null, soft: R.SoftBodyDesc | undefined;
    if ('circle' in options.shape) {
      const radius = positive(options.shape.circle, 'Radius');
      collider = R.ColliderDesc.ball(radius);
      if (m.softness && !options.fixed) soft = R.SoftBodyDesc.disk(at, radius, 32);
    } else if ('box' in options.shape) {
      coordinates(options.shape.box, 2);
      const [w, h] = options.shape.box.map((v) => positive(v, 'Box size')) as [number, number];
      collider = R.ColliderDesc.cuboid(w / 2, h / 2);
      if (m.softness && !options.fixed)
        soft = R.SoftBodyDesc.grid(at, { x: w / 2, y: h / 2 }, 5, 5);
    } else {
      const points = options.shape.polygon;
      if (points.length < 3) throw new Error('A polygon needs at least three points');
      points.forEach((p) => vector(p));
      const edges = Uint32Array.from(points.flatMap((_, i) => [i, (i + 1) % points.length]));
      collider = R.ColliderDesc.convexDecomposition(new Float32Array(points.flat()), edges);
      if (m.softness && !options.fixed)
        soft = R.SoftBodyDesc.polygon(points.flatMap(([x, y]) => [x + at.x, y + at.y]));
    }
    if (!collider) throw new Error(`Cannot build a collider for ${id}`);
    collider.setFriction(m.friction).setRestitution(m.restitution).setMass(mass);
    let rigidHandle: number, softHandle: number | undefined;
    if (soft) {
      const s = runtime.raw.createSoftBody(
        soft
          .setMass(mass)
          .setSoftness(m.softness!, 0.8)
          .setShapeMatching(true)
          .setLinearDamping(m.damping)
          .setParticleRadius(0.01)
          .setSurfaceCollider(collider),
      );
      softHandle = s.handle;
      rigidHandle = s.rootBody().handle;
    } else {
      const desc = options.fixed ? R.RigidBodyDesc.fixed() : R.RigidBodyDesc.dynamic();
      const r = runtime.raw.createRigidBody(
        desc
          .setTranslation(at.x, at.y)
          .setLinearDamping(m.damping)
          .setAngularDamping(0.15)
          .setCcdEnabled(!options.fixed),
      );
      try {
        runtime.raw.createCollider(collider, r);
      } catch (error) {
        runtime.raw.removeRigidBody(r);
        throw error;
      }
      rigidHandle = r.handle;
    }
    const life = bodyLifetime(runtime, id, {
      awake: () => !result.fixed && !(result.soft ?? result.rigid).isSleeping(),
      remove() {
        if (result.soft) runtime.raw.removeSoftBody(result.soft);
        else runtime.raw.removeRigidBody(result.rigid);
      },
    });
    const result: Body2D = {
      id,
      world: runtime,
      shape: options.shape,
      fixed: options.fixed ?? false,
      get rigid() {
        life.assertLive();
        return runtime.raw.getRigidBody(rigidHandle);
      },
      get soft() {
        life.assertLive();
        return softHandle === undefined ? undefined : runtime.raw.getSoftBody(softHandle);
      },
      get position(): Vec2 {
        const p = result.rigid.translation();
        return [p.x, p.y];
      },
      impulse(value: Vec2) {
        (result.soft ?? result.rigid).applyImpulse(vector(value), true);
        runtime.wake();
      },
      get disposed() {
        return life.disposed;
      },
      onDispose: life.onDispose,
      dispose: life.dispose,
    };
    return result;
  }
  function spring(a: Body2D, b: Body2D, options: SpringOptions = {}) {
    if (a.world !== runtime || b.world !== runtime)
      throw new Error('A spring connects bodies in the same world');
    const { length, stiffness, damping } = springSettings(a.position, b.position, options);
    const joint = runtime.raw.createImpulseJoint(
      R.JointData.spring(length, stiffness, damping, { x: 0, y: 0 }, { x: 0, y: 0 }),
      a.rigid,
      b.rigid,
      true,
    );
    const handle = joint.handle;
    return springLifetime(runtime, [a, b], () => {
      const current = runtime.raw.getImpulseJoint(handle);
      if (current) runtime.raw.removeImpulseJoint(current, true);
    });
  }
  return Object.assign(runtime, { body, spring });
}
export type World2D = Awaited<ReturnType<typeof world2D>>;
