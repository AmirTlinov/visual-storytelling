import R from '@dimforge/rapier3d-compat';
import { Vector3, Quaternion, Matrix4 } from 'three';
import { positive } from './materials.js';
import { bodyLifetime } from './body.js';
import type { World3D } from './world3d.js';
import type { VolumeMorph } from '../viewport/morph/surface.js';

export interface MorphCollider3DOptions {
  id: string;
  /** Contact resolution in scene units; fixed during the transformation. */
  cellSize?: number;
  friction?: number;
  restitution?: number;
}

const owners = new WeakSet<object>();

/** An authored volume is a moving boundary. Rapier owns the surrounding bodies' response. */
export function physicalVolume(
  world: World3D,
  surface: ReturnType<typeof VolumeMorph.mount>,
  options: MorphCollider3DOptions,
) {
  const cell = positive(options.cellSize ?? 0.1, 'Morph contact resolution');
  const friction = options.friction ?? 0.5,
    restitution = options.restitution ?? 0.15;
  if (
    !Number.isFinite(friction) ||
    friction < 0 ||
    !Number.isFinite(restitution) ||
    restitution < 0 ||
    restitution > 1
  )
    throw new Error('Morph friction must be non-negative and restitution between zero and one');
  if (owners.has(surface)) throw new Error('A volume surface can have only one physics binding');
  world.reserve(options.id);
  const body = world.raw.createRigidBody(R.RigidBodyDesc.fixed());
  const desc = R.ColliderDesc.ball(cell / 2)
    .setEnabled(false)
    .setFriction(friction)
    .setRestitution(restitution);
  const handle = body.handle;
  let colliderHandle: number;
  try {
    colliderHandle = world.raw.createCollider(desc, body).handle;
  } catch (error) {
    world.raw.removeRigidBody(body);
    throw error;
  }
  const position = new Vector3(),
    rotation = new Quaternion(),
    scale = new Vector3(),
    matrix = new Matrix4(),
    composed = new Matrix4();
  let shapeScale = new Vector3(NaN, NaN, NaN);
  let revision = -1,
    native = world.raw;
  const life = bodyLifetime(world, options.id, {
    awake: () => false,
    remove: () => world.raw.removeRigidBody(world.raw.getRigidBody(handle)),
  });
  let offChange = () => {},
    offSurface = () => {},
    offRender = () => {},
    offStep = () => {};
  owners.add(surface);
  life.onDispose(() => {
    owners.delete(surface);
    offChange();
    offSurface();
    offRender();
    offStep();
  });
  function sync() {
    if (life.disposed || world.disposed) return;
    const geometry = surface.geometry;
    const collider = world.raw.getCollider(colliderHandle);
    if (!geometry) {
      collider.setEnabled(false);
      revision = -1;
      return;
    }
    surface.object.updateWorldMatrix(true, false);
    const moved =
      revision < 0 || !matrix.equals(surface.object.matrixWorld) || native !== world.raw;
    if (moved) {
      surface.object.matrixWorld.decompose(position, rotation, scale);
      if ([scale.x, scale.y, scale.z].some((n) => !Number.isFinite(n) || n <= 0))
        throw new Error('A physical morph needs positive world scale');
      composed.compose(position, rotation, scale);
      if (
        composed.elements.some(
          (n, i) =>
            Math.abs(n - surface.object.matrixWorld.elements[i]!) > 1e-8 * Math.max(1, Math.abs(n)),
        )
      )
        throw new Error(
          'Physical morph transforms cannot contain shear; rotate before applying non-uniform scale',
        );
      const rigid = world.raw.getRigidBody(handle);
      rigid.setTranslation(position, true);
      rigid.setRotation(rotation, true);
      matrix.copy(surface.object.matrixWorld);
    }
    const changed =
      native !== world.raw || revision !== geometry.revision || !scale.equals(shapeScale);
    if (!changed && !moved) return;
    if (changed) {
      const { min, max } = geometry.bounds;
      const lower = [min.x, min.y, min.z].map((n) => Math.floor(n / cell));
      const upper = [max.x, max.y, max.z].map((n) => Math.ceil(n / cell));
      const samples = upper.reduce((n, v, i) => n * (v - lower[i]!), 1);
      if (samples > 1_000_000)
        throw new Error('Morph contact grid exceeds one million samples; increase cellSize');
      const voxels: number[] = [];
      for (let z = lower[2]!; z < upper[2]!; z++)
        for (let y = lower[1]!; y < upper[1]!; y++)
          for (let x = lower[0]!; x < upper[0]!; x++)
            if (geometry.distance((x + 0.5) * cell, (y + 0.5) * cell, (z + 0.5) * cell) <= 0)
              voxels.push(x, y, z);
      if (voxels.length)
        collider.setShape(
          new R.Voxels(new Int32Array(voxels), {
            x: cell * scale.x,
            y: cell * scale.y,
            z: cell * scale.z,
          }),
        );
      collider.setEnabled(voxels.length > 0);
      revision = geometry.revision;
      native = world.raw;
      shapeScale.copy(scale);
    }
    // A boundary may have grown into a settled body; include it in the next solver step.
    world.raw.forEachRigidBody((other) => {
      if (other.isDynamic()) other.wakeUp();
    });
    world.wake();
  }
  try {
    offChange = surface.onChange(sync);
    offSurface = surface.onDispose(life.dispose);
    offStep = world.beforeStep(sync);
    offRender = world.onRender(sync);
  } catch (error) {
    life.dispose();
    throw error;
  }
  return {
    get rigid() {
      life.assertLive();
      return world.raw.getRigidBody(handle);
    },
    get collider() {
      life.assertLive();
      return world.raw.getCollider(colliderHandle);
    },
    get disposed() {
      return life.disposed;
    },
    cellSize: cell,
    sync,
    dispose: life.dispose,
  };
}
