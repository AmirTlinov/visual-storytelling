import R from '@dimforge/rapier2d-compat';
import { inkVoxels, type FusionGeometry } from '../ink/fusion/geometry.js';
import { bodyLifetime } from './body.js';
import { coordinates, positive } from './materials.js';
import type { World2D, Vec2 } from './world2d.js';

export interface MorphSurface2D {
  readonly geometry: FusionGeometry | undefined;
  onChange(listener: (geometry: FusionGeometry) => void): () => void;
  onDispose(listener: () => void): () => void;
}
export interface PhysicalMorph2DOptions {
  id: string;
  /** Drawing units per world unit. */
  scale?: number;
  /** Collider sampling size, in drawing units. */
  cellSize?: number;
  at?: Vec2;
  friction?: number;
  restitution?: number;
}
const owners = new WeakSet<MorphSurface2D>();

/** A fixed obstacle follows the displayed ink field; the existing world owns contacts and time. */
export function physicalMorph2D(
  world: World2D,
  surface: MorphSurface2D,
  options: PhysicalMorph2DOptions,
) {
  const scale = positive(options.scale ?? 100, 'Drawing scale');
  const cellSize = positive(options.cellSize ?? 1, 'Morph collider cell size');
  const at = options.at ?? [0, 0];
  coordinates(at, 2);
  const friction = options.friction ?? 0.5,
    restitution = options.restitution ?? 0;
  if (
    !Number.isFinite(friction) ||
    friction < 0 ||
    !Number.isFinite(restitution) ||
    restitution < 0 ||
    restitution > 1
  )
    throw new Error('Morph friction must be non-negative and restitution between zero and one');
  if (owners.has(surface)) throw new Error('An ink surface can have only one physics binding');
  world.reserve(options.id);
  const rigid = world.raw.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(at[0], at[1]));
  const bodyHandle = rigid.handle;
  let colliderHandle: number;
  try {
    colliderHandle = world.raw.createCollider(
      R.ColliderDesc.ball(0.001)
        .setEnabled(false)
        .setFriction(friction)
        .setRestitution(restitution),
      rigid,
    ).handle;
  } catch (error) {
    world.raw.removeRigidBody(rigid);
    throw error;
  }
  const life = bodyLifetime(world, options.id, {
    awake: () => false,
    remove: () => world.raw.removeRigidBody(world.raw.getRigidBody(bodyHandle)),
  });
  let revision = -1,
    native = world.raw;
  let offChange = () => {},
    offSurface = () => {},
    offRender = () => {};
  owners.add(surface);
  life.onDispose(() => {
    owners.delete(surface);
    offChange();
    offSurface();
    offRender();
  });
  function sync() {
    if (life.disposed || world.disposed) return;
    const geometry = surface.geometry;
    if (!geometry || (geometry.revision === revision && native === world.raw)) return;
    const cells = inkVoxels(geometry, cellSize);
    const collider = world.raw.getCollider(colliderHandle);
    if (cells.length) {
      const size = cellSize / scale;
      collider.setShape(R.ColliderDesc.voxels(cells, { x: size, y: size }).shape);
    }
    collider.setEnabled(cells.length > 0);
    revision = geometry.revision;
    native = world.raw;
    // A sleeping body may lose its support when ink divides or moves away.
    world.raw.forEachRigidBody((body) => {
      if (body.isDynamic()) body.wakeUp();
    });
    world.wake();
  }
  try {
    offChange = surface.onChange(sync);
    offSurface = surface.onDispose(life.dispose);
    offRender = world.onRender(sync);
    sync();
  } catch (error) {
    life.dispose();
    throw error;
  }
  return {
    get rigid() {
      life.assertLive();
      return world.raw.getRigidBody(bodyHandle);
    },
    get collider() {
      life.assertLive();
      return world.raw.getCollider(colliderHandle);
    },
    get disposed() {
      return life.disposed;
    },
    sync,
    dispose: life.dispose,
  };
}
