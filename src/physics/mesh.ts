import R from '@dimforge/rapier3d-compat';
import { Mesh, Vector2, Vector3, Quaternion, Matrix4, Raycaster, Plane } from 'three';
import type { Viewport3D } from '../viewport/three.js';
import type { World3D, Body3D, BodyOptions3D } from './world3d.js';
import { pointerGrab } from './grab.js';
import { meshSurface } from './mesh-surface.js';

type View = ReturnType<typeof Viewport3D.mount>;
/** Existing geometry, materials, children and labels stay owned by their original view. */
export function physicalMeshes(world: World3D, view: View) {
  const bindings = new Map<Mesh, Body3D>(),
    cleanups = new Set<() => void>();
  const draggable = new Set<Mesh>();
  const raycaster = new Raycaster(),
    pointer = new Vector2();
  const ray = (event: PointerEvent) => {
    const box = view.renderer.domElement.getBoundingClientRect();
    pointer.set(
      ((event.clientX - box.left) / box.width) * 2 - 1,
      1 - ((event.clientY - box.top) / box.height) * 2,
    );
    raycaster.setFromCamera(pointer, view.camera);
    return raycaster;
  };
  const grab = pointerGrab(
    view.renderer.domElement,
    (event) => {
      const hit = ray(event).intersectObjects([...draggable], false)[0];
      if (!hit) return;
      const physical = bindings.get(hit.object as Mesh)!;
      return physical.fixed ? undefined : { physical, point: hit.point };
    },
    ({ physical, point: initial }, event) => {
      const oldControls = view.controls.enabled;
      view.controls.enabled = false;
      const plane = new Plane().setFromNormalAndCoplanarPoint(
        view.camera.getWorldDirection(new Vector3()),
        initial,
      );
      const point = initial.clone();
      const move = (e: PointerEvent) => {
        ray(e).ray.intersectPlane(plane, point);
        world.wake();
      };
      move(event);
      const soft = physical.soft;
      if (soft) {
        let nearest = 0,
          best = Infinity;
        for (let i = 0; i < soft.numParticles(); i++) {
          const p = soft.particlePosition(i),
            d = (p.x - point.x) ** 2 + (p.y - point.y) ** 2 + (p.z - point.z) ** 2;
          if (d < best) {
            nearest = i;
            best = d;
          }
        }
        const pinned = soft.isParticlePinned(nearest);
        soft.setParticlePinned(nearest, true);
        const stop = world.beforeStep(() =>
          physical.soft?.setParticleKinematicTarget(nearest, point),
        );
        world.wake();
        return {
          move,
          release() {
            stop();
            physical.soft?.setParticlePinned(nearest, pinned);
            view.controls.enabled = oldControls;
          },
        };
      }
      const cursor = world.raw.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased().setTranslation(point.x, point.y, point.z),
      );
      const p = physical.rigid.translation(),
        rotation = physical.rigid.rotation();
      const anchor = point
        .clone()
        .sub(new Vector3(p.x, p.y, p.z))
        .applyQuaternion(new Quaternion(rotation.x, rotation.y, rotation.z, rotation.w).invert());
      const mass = physical.rigid.mass();
      const joint = world.raw.createImpulseJoint(
        R.JointData.spring(0, mass * 600, mass * 35, anchor, { x: 0, y: 0, z: 0 }),
        physical.rigid,
        cursor,
        true,
      );
      const stop = world.beforeStep(() => cursor.setNextKinematicTranslation(point));
      world.wake();
      return {
        move,
        release() {
          stop();
          world.raw.removeImpulseJoint(joint, true);
          world.raw.removeRigidBody(cursor);
          view.controls.enabled = oldControls;
        },
      };
    },
  );
  function body(
    id: string,
    mesh: Mesh,
    options: Omit<BodyOptions3D, 'shape' | 'at'> & { cellSize?: number; draggable?: boolean } = {},
  ) {
    if (bindings.has(mesh)) throw new Error('A mesh can have only one physical owner');
    mesh.updateWorldMatrix(true, false);
    const initialPosition = mesh.getWorldPosition(new Vector3());
    const initialRotation = mesh.getWorldQuaternion(new Quaternion());
    const attribute = mesh.geometry.getAttribute('position');
    const vertices = new Float32Array(attribute.count * 3),
      v = new Vector3();
    for (let i = 0; i < attribute.count; i++) {
      v.fromBufferAttribute(attribute, i).applyMatrix4(mesh.matrixWorld).sub(initialPosition);
      v.toArray(vertices, i * 3);
    }
    const indices = mesh.geometry.index
      ? new Uint32Array(mesh.geometry.index.array)
      : Uint32Array.from({ length: attribute.count }, (_, i) => i);
    const surface = meshSurface(vertices, indices);
    const physical = world.body(id, {
      ...options,
      at: initialPosition.toArray() as [number, number, number],
      shape: { vertices: surface.vertices, indices: surface.indices, cellSize: options.cellSize },
    });
    bindings.set(mesh, physical);
    if (!physical.fixed && options.draggable !== false) draggable.add(mesh);
    const original = mesh.geometry;
    if (physical.soft) mesh.geometry = original.clone();
    const inverse = new Matrix4(),
      q = new Quaternion(),
      parentQ = new Quaternion();
    const stop = world.onRender(() => {
      const p = physical.rigid.translation(),
        rotation = physical.rigid.rotation();
      mesh.position.set(p.x, p.y, p.z);
      if (mesh.parent) mesh.parent.worldToLocal(mesh.position);
      q.set(rotation.x, rotation.y, rotation.z, rotation.w).multiply(initialRotation);
      if (mesh.parent) q.premultiply(mesh.parent.getWorldQuaternion(parentQ).invert());
      mesh.quaternion.copy(q);
      const soft = physical.soft;
      if (soft) {
        const positions = soft.meshVertices(0);
        mesh.updateWorldMatrix(true, false);
        inverse.copy(mesh.matrixWorld).invert();
        const target = mesh.geometry.getAttribute('position');
        for (let i = 0; i < target.count; i++) {
          const index = surface.visualToPhysical[i]!;
          if (index < 0) continue; // Unreferenced visual vertices stay untouched.
          v.fromArray(positions, index * 3).applyMatrix4(inverse);
          target.setXYZ(i, v.x, v.y, v.z);
        }
        target.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
        mesh.geometry.computeBoundingBox();
        mesh.geometry.computeBoundingSphere();
      }
      view.invalidate();
    });
    const coreDispose = physical.dispose;
    function dispose() {
      grab.release();
      stop();
      bindings.delete(mesh);
      draggable.delete(mesh);
      if (mesh.geometry !== original) {
        mesh.geometry.dispose();
        mesh.geometry = original;
      }
      coreDispose();
      cleanups.delete(dispose);
    }
    cleanups.add(dispose);
    return Object.assign(physical, { mesh, dispose });
  }
  const off = world.onDispose(dispose);
  const stopCheckpoint = world.beforeCheckpoint(grab.release);
  function dispose() {
    grab.dispose();
    for (const cleanup of [...cleanups]) cleanup();
    off();
    stopCheckpoint();
  }
  return { body, dispose };
}
