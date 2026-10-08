import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  OrthographicCamera,
  Scene,
  Texture,
  WebGLRenderer,
} from 'three';
import type { FrameBox } from './staging/camera.js';
import type { Point } from './types.js';
import type { CharacterPerformance } from './performance.js';
import type { CharacterMesh } from './rig.js';

export interface StageColor {
  r: number;
  g: number;
  b: number;
  a: number;
}
export const stageColor = (hex: string, alpha = 1): StageColor => ({ ...new Color(hex), a: alpha });
export async function stageTexture(svg: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const image = new Image();
  const abort = () => image.removeAttribute('src');
  signal?.addEventListener('abort', abort, { once: true });
  image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  try {
    await image.decode();
    signal?.throwIfAborted();
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
  }
  const texture = new Texture(image);
  texture.needsUpdate = true;
  texture.colorSpace = 'srgb';
  return texture;
}

/** Ordered 2.5D drawing passes share one Three renderer with the live DOM surfaces. */
export function characterCompositor(canvas: HTMLCanvasElement) {
  const renderer = new WebGLRenderer({
    canvas,
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: true,
  });
  renderer.autoClear = false;
  renderer.setClearColor(0, 0);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100),
    scene = new Scene();
  camera.position.z = 10;
  const primitives: Mesh<BufferGeometry, MeshBasicMaterial>[] = [];
  let used = 0,
    sequence = 0;
  const queued: Object3D[] = [];
  const actors = new Map<CharacterPerformance, { mesh: CharacterMesh; order: number }[]>();
  function primitive(points: number[], tint: StageColor, texture?: Texture) {
    let mesh = primitives[used++];
    if (!mesh) {
      mesh = new Mesh(
        new BufferGeometry(),
        new MeshBasicMaterial({
          transparent: true,
          depthTest: false,
          depthWrite: false,
          side: DoubleSide,
          toneMapped: false,
        }),
      );
      mesh.frustumCulled = false;
      primitives.push(mesh);
    }
    const current = mesh.geometry.getAttribute('position');
    if (!current || current.array.length < points.length)
      mesh.geometry.setAttribute('position', new BufferAttribute(new Float32Array(points), 3));
    else {
      current.array.set(points);
      current.needsUpdate = true;
    }
    mesh.geometry.setDrawRange(0, points.length / 3);
    mesh.material.color.setRGB(tint.r, tint.g, tint.b);
    mesh.material.opacity = tint.a;
    if (mesh.material.map !== texture) {
      mesh.material.map = texture ?? null;
      mesh.material.needsUpdate = true;
    }
    mesh.renderOrder = sequence++;
    queued.push(mesh);
    return mesh;
  }
  const api = {
    renderer,
    frame(box: FrameBox, stageHeight: number, width: number, height: number) {
      if (canvas.width !== width || canvas.height !== height)
        renderer.setSize(width, height, false);
      camera.left = -box.width / 2;
      camera.right = box.width / 2;
      camera.top = box.height / 2;
      camera.bottom = -box.height / 2;
      camera.position.set(box.x + box.width / 2, stageHeight - box.y - box.height / 2, 10);
      camera.updateProjectionMatrix();
      used = sequence = 0;
      renderer.clear();
    },
    clear() {
      renderer.clear();
    },
    image(texture: Texture, box: FrameBox) {
      const { x, y, width: w, height: h } = box;
      const mesh = primitive(
        [x, y, 0, x + w, y, 0, x, y + h, 0, x, y + h, 0, x + w, y, 0, x + w, y + h, 0],
        { r: 1, g: 1, b: 1, a: 1 },
        texture,
      );
      if (!mesh.geometry.getAttribute('uv'))
        mesh.geometry.setAttribute(
          'uv',
          new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), 2),
        );
    },
    polygon(points: readonly Point[], fill: StageColor, stroke?: StageColor, width = 0) {
      const vertices: number[] = [];
      for (let i = 2; i < points.length; i++)
        for (const p of [points[0]!, points[i - 1]!, points[i]!]) vertices.push(p.x, p.y, 0);
      primitive(vertices, fill);
      if (stroke && width > 0)
        for (let i = 0; i < points.length; i++)
          api.segment(points[i]!, points[(i + 1) % points.length]!, width, stroke);
    },
    segment(a: Point, b: Point, width: number, color: StageColor) {
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (length < 1e-8) return;
      const x = ((b.y - a.y) * width) / (length * 2),
        y = ((a.x - b.x) * width) / (length * 2);
      api.polygon(
        [
          { x: a.x + x, y: a.y + y },
          { x: b.x + x, y: b.y + y },
          { x: b.x - x, y: b.y - y },
          { x: a.x - x, y: a.y - y },
        ],
        color,
      );
    },
    actor(actor: CharacterPerformance, meshes = actor.orderedMeshes()) {
      const entries = actors.get(actor) ?? [];
      for (const mesh of meshes) entries.push({ mesh, order: sequence++ });
      actors.set(actor, entries);
    },
    flush() {
      if (!queued.length && !actors.size) return;
      const restore: { mesh: CharacterMesh; visible: boolean; order: number }[] = [];
      for (const [actor, entries] of actors) {
        for (const mesh of actor.meshes) {
          restore.push({ mesh, visible: mesh.visible, order: mesh.renderOrder });
          mesh.visible = false;
        }
        for (const { mesh, order } of entries) {
          mesh.visible = true;
          mesh.renderOrder = order;
        }
        scene.add(actor.object);
      }
      for (const object of queued) scene.add(object);
      try {
        renderer.render(scene, camera);
      } finally {
        scene.clear();
        queued.length = 0;
        actors.clear();
        for (const entry of restore) {
          entry.mesh.visible = entry.visible;
          entry.mesh.renderOrder = entry.order;
        }
      }
    },
    dispose() {
      for (const mesh of primitives) {
        mesh.geometry.dispose();
        mesh.material.dispose();
      }
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
  return api;
}
export type CharacterCompositor = ReturnType<typeof characterCompositor>;
