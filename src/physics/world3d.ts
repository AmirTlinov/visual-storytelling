import R from '@dimforge/rapier3d-compat';
import { physicsRuntime } from './runtime.js';
import { coordinates, material, positive, type MaterialChoice } from './materials.js';

export type Vec3 = readonly [number, number, number];
export type Shape3D =
  | { sphere: number }
  | { box: Vec3 }
  | { vertices: Float32Array; indices: Uint32Array; cellSize?: number };
export interface BodyOptions3D {
  shape: Shape3D;
  at?: Vec3;
  material?: MaterialChoice;
  mass?: number;
  fixed?: boolean;
}
export interface Body3D {
  readonly id: string;
  readonly world: ReturnType<typeof physicsRuntime<R.World>>;
  readonly shape: Shape3D;
  readonly fixed: boolean;
  readonly rigid: R.RigidBody;
  readonly soft: R.SoftBody | undefined;
  readonly position: Vec3;
  impulse(value: Vec3): void;
  dispose(): void;
}
let ready: Promise<void> | undefined;
const vector = (p: Vec3) => {
  coordinates(p, 3);
  return { x: p[0], y: p[1], z: p[2] };
};

export async function world3D({ gravity = [0, -9.81, 0] as Vec3 } = {}) {
  await (ready ??= R.init());
  const runtime = physicsRuntime(new R.World(vector(gravity)), R.World.restoreSnapshot);
  function body(id: string, options: BodyOptions3D): Body3D {
    runtime.reserve(id);
    const at = vector(options.at ?? [0, 0, 0]),
      m = material(options.material);
    const mass = positive(options.mass ?? 1, 'Mass');
    let collider: R.ColliderDesc | null, soft: R.SoftBodyDesc | null | undefined;
    if ('sphere' in options.shape) {
      const radius = positive(options.shape.sphere, 'Radius');
      collider = R.ColliderDesc.ball(radius);
      if (m.softness && !options.fixed) soft = R.SoftBodyDesc.sphere(at, radius, 2);
    } else if ('box' in options.shape) {
      coordinates(options.shape.box, 3);
      const [x, y, z] = options.shape.box.map((v) => positive(v, 'Box size')) as [
        number,
        number,
        number,
      ];
      collider = R.ColliderDesc.cuboid(x / 2, y / 2, z / 2);
      if (m.softness && !options.fixed)
        soft = R.SoftBodyDesc.cuboid(at, { x: x / 2, y: y / 2, z: z / 2 }, 4, 4, 4);
    } else {
      const { vertices, indices } = options.shape;
      if (
        vertices.length < 12 ||
        vertices.length % 3 ||
        !vertices.every(Number.isFinite) ||
        indices.length % 3 ||
        indices.some((index) => index >= vertices.length / 3)
      )
        throw new Error('Mesh positions and triangle indices must be valid');
      collider = options.fixed
        ? R.ColliderDesc.trimesh(vertices, indices)
        : m.softness
          ? R.ColliderDesc.ball(0.01)
          : R.ColliderDesc.convexDecomposition(vertices, indices);
      if (m.softness && !options.fixed) {
        soft = R.SoftBodyDesc.volumetric(
          vertices,
          indices,
          positive(options.shape.cellSize ?? 0.2, 'Cell size'),
          true,
        );
        if (!soft) throw new Error(`A deformable mesh needs a closed surface: ${id}`);
        soft.setTranslation(at);
      }
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
          .setTranslation(at.x, at.y, at.z)
          .setLinearDamping(m.damping)
          .setAngularDamping(0.15)
          .setCcdEnabled(!options.fixed),
      );
      runtime.raw.createCollider(collider, r);
      rigidHandle = r.handle;
    }
    let removed = false;
    const requireBody = () => {
      if (removed) throw new Error(`Physical body was removed: ${id}`);
    };
    const result: Body3D = {
      id,
      world: runtime,
      shape: options.shape,
      fixed: options.fixed ?? false,
      get rigid() {
        requireBody();
        return runtime.raw.getRigidBody(rigidHandle);
      },
      get soft() {
        requireBody();
        return softHandle === undefined ? undefined : runtime.raw.getSoftBody(softHandle);
      },
      get position(): Vec3 {
        const p = result.rigid.translation();
        return [p.x, p.y, p.z];
      },
      impulse(value: Vec3) {
        (result.soft ?? result.rigid).applyImpulse(vector(value), true);
        runtime.wake();
      },
      dispose() {
        if (removed) return;
        if (result.soft) runtime.raw.removeSoftBody(result.soft);
        else runtime.raw.removeRigidBody(result.rigid);
        removed = true;
        untrack();
        runtime.sync();
      },
    };
    const untrack = runtime.track(id, {
      awake: () => !result.fixed && !(result.soft ?? result.rigid).isSleeping(),
      dispose: result.dispose,
    });
    return result;
  }
  function spring(
    a: Body3D,
    b: Body3D,
    options: { length?: number; stiffness?: number; damping?: number } = {},
  ) {
    if (a.world !== runtime || b.world !== runtime)
      throw new Error('A spring connects bodies in the same world');
    const length = options.length ?? Math.hypot(...a.position.map((v, i) => v - b.position[i]!));
    if (!Number.isFinite(length) || length < 0)
      throw new Error('Spring length must be non-negative');
    const joint = runtime.raw.createImpulseJoint(
      R.JointData.spring(
        length,
        positive(options.stiffness ?? 30, 'Spring stiffness'),
        positive(options.damping ?? 3, 'Spring damping'),
        { x: 0, y: 0, z: 0 },
        { x: 0, y: 0, z: 0 },
      ),
      a.rigid,
      b.rigid,
      true,
    );
    const handle = joint.handle;
    runtime.topologyChanged();
    return {
      dispose() {
        const j = runtime.raw.getImpulseJoint(handle);
        if (j) {
          runtime.raw.removeImpulseJoint(j, true);
          runtime.topologyChanged();
        }
      },
    };
  }
  return Object.assign(runtime, { body, spring });
}
export type World3D = Awaited<ReturnType<typeof world3D>>;
