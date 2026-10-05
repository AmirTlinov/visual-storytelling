import * as T from '../viewport/engine.js';
import type { Viewport3DHandle } from '../viewport/three.js';

/** Once inside the page, only the departing sheet moves; no book frame returns around the story. */
export function pageTurn(
  view: Viewport3DHandle,
  options: { current: HTMLCanvasElement; previous: HTMLCanvasElement },
) {
  const root = new T.Group();
  const texture = (canvas: HTMLCanvasElement) => {
    const map = new T.CanvasTexture(canvas);
    map.colorSpace = T.SRGBColorSpace;
    map.anisotropy = 4;
    return map;
  };
  const currentMap = texture(options.current),
    previousMap = texture(options.previous);
  const paper = view.ink(new T.MeshBasicMaterial({ side: T.DoubleSide }), 'surface');
  const ground = new T.Mesh(new T.PlaneGeometry(1, 1), paper);
  const current = new T.Mesh(
    ground.geometry,
    new T.MeshBasicMaterial({ map: currentMap, transparent: true }),
  );
  current.position.z = 0.002;
  const geometry = new T.PlaneGeometry(1, 1, 64, 1);
  const leaf = new T.Mesh(geometry, paper);
  const drawing = new T.Mesh(
    geometry,
    new T.MeshBasicMaterial({ map: previousMap, transparent: true, side: T.FrontSide }),
  );
  leaf.position.z = 0.02;
  drawing.position.z = 0.022;
  root.add(ground, current, leaf, drawing);
  root.traverse((node) => {
    if (node instanceof T.Mesh)
      node.userData.visualReview = () => ({ framing: node === current ? 'subject' : 'background' });
  });
  return {
    root,
    pagesChanged() {
      currentMap.needsUpdate = previousMap.needsUpdate = true;
    },
    render(progress: number, aspect: number) {
      const t = Math.max(0, Math.min(1, progress));
      const w = aspect * 10,
        h = 10;
      ground.scale.set(w, h, 1);
      current.scale.copy(ground.scale);
      const positions = geometry.getAttribute('position'),
        uv = geometry.getAttribute('uv');
      const angle = Math.PI * t;
      for (let i = 0; i < positions.count; i++) {
        const u = uv.getX(i),
          v = uv.getY(i);
        positions.setXYZ(
          i,
          -w / 2 + u * w * Math.cos(angle),
          (v - 0.5) * h,
          Math.sin(angle) * (u * w * 0.12 + Math.sin(Math.PI * u) * 0.65),
        );
      }
      positions.needsUpdate = true;
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      drawing.visible = t < 0.5;
      leaf.visible = t < 1;
      // A curl keeps the same perspective after any notebook zoom or rewind.
      view.camera.fov = 36;
      view.shot({
        target: new T.Box3(new T.Vector3(-w / 2, -h / 2, 0), new T.Vector3(w / 2, h / 2, 0)),
        direction: [0, 0, 1],
        padding: 0,
        reduced: false,
      });
    },
  };
}
