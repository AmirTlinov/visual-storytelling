import { Box3, Vector3, type Camera, type Object3D, type Mesh } from 'three';
import { subjectOf } from './semantics.js';

type InspectableCanvas = HTMLCanvasElement & { __visualReview?: () => unknown };

/** Read on demand by visual review. No polling, extra rendering or alternate model. */
export function attachInspection(
  canvas: HTMLCanvasElement,
  scene: Object3D,
  camera: Camera,
  receipt: () => unknown,
) {
  const target = canvas as InspectableCanvas;
  target.__visualReview = () => {
    const viewport = canvas.getBoundingClientRect();
    const ids = new Map<Object3D, string>();
    const identify = (node: Object3D): string => {
      let id = ids.get(node);
      if (!id) {
        const subject = subjectOf(node);
        id =
          node === scene ? '3d:scene' : subject?.object === node ? subject.id : `3d:${node.uuid}`;
        ids.set(node, id);
      }
      return id;
    };
    const objects: unknown[] = [];
    scene.traverse((node) => {
      if (
        objects.length >= 400 ||
        (!(node as Mesh).isMesh && !node.userData.visualReview && subjectOf(node)?.object !== node)
      )
        return;
      const box = new Box3().setFromObject(node);
      if (box.isEmpty()) return;
      const points = [];
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) points.push(new Vector3(x, y, z).project(camera));
      if (points.some((p) => ![p.x, p.y, p.z].every(Number.isFinite))) return;
      const left = Math.min(...points.map((p) => p.x)),
        right = Math.max(...points.map((p) => p.x));
      const top = Math.max(...points.map((p) => p.y)),
        bottom = Math.min(...points.map((p) => p.y));
      let visible = true;
      const ancestors: string[] = [];
      for (let p: Object3D | null = node; p; p = p.parent) {
        visible &&= p.visible;
        if (p !== node) ancestors.push(identify(p));
      }
      const details =
        typeof node.userData.visualReview === 'function'
          ? node.userData.visualReview()
          : node.userData.visualReview;
      const subject = subjectOf(node);
      objects.push({
        id: identify(node),
        subjectId: subject?.id,
        identity: subject?.object === node ? 'authored' : 'render-local',
        uuid: node.uuid,
        ancestors,
        parent: node.parent ? identify(node.parent) : undefined,
        text: subject?.meaning.label ?? details?.text,
        source: subject?.meaning.source ?? details?.source,
        data: details,
        x: viewport.x + ((left + 1) * viewport.width) / 2,
        y: viewport.y + ((1 - top) * viewport.height) / 2,
        width: ((right - left) * viewport.width) / 2,
        height: ((top - bottom) * viewport.height) / 2,
        depth: Math.min(...points.map((p) => p.z)),
        visible,
        matrix: node.matrixWorld.toArray(),
        evidence: 'projected geometry bounds; occlusion requires the image',
      });
    });
    return {
      receipt: receipt(),
      camera: {
        matrix: camera.matrixWorld.toArray(),
        projection: camera.projectionMatrix.toArray(),
      },
      objects,
    };
  };
  return () => {
    delete target.__visualReview;
  };
}
