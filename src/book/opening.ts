import * as T from '../viewport/engine.js';
import type { Viewport3DHandle } from '../viewport/three.js';
import { bookSize } from './geometry.js';
import { coverTexture } from './cover.js';
import { bookOpening } from './timing.js';

const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** An opening shot owns a physical desk and ruled paper, never a chapter screenshot. */
export function notebookOpening(view: Viewport3DHandle, topic: string) {
  const root = new T.Group(),
    notebook = new T.Group();
  const { width: w, height: h } = bookSize;
  const cloth = new T.MeshStandardMaterial({ color: '#345660', roughness: 0.95 });
  const binding = new T.MeshStandardMaterial({ color: '#203e46', roughness: 0.95 });
  const edges = new T.MeshStandardMaterial({ color: '#deded6', roughness: 1 });
  const paper = view.ink(new T.MeshBasicMaterial(), 'surface');
  const map = new T.CanvasTexture(coverTexture(topic));
  map.colorSpace = T.SRGBColorSpace;
  map.anisotropy = 8;
  const cover = new T.MeshBasicMaterial({ map });
  const board = (face: T.MeshBasicMaterial, z: number) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w + 0.16, h + 0.16, 0.085), [
      cloth,
      binding,
      cloth,
      cloth,
      face,
      paper,
    ]);
    mesh.position.set(w / 2, 0, z);
    return mesh;
  };
  notebook.add(board(paper, -0.1));
  const stack = new T.Mesh(new T.BoxGeometry(w - 0.08, h - 0.1, 0.21), edges);
  stack.position.set(w / 2, 0, 0.055);
  notebook.add(stack);
  for (let i = 0; i < 6; i++) {
    const line = new T.Mesh(
      new T.BoxGeometry(w - 0.08, 0.012, 0.006),
      new T.MeshBasicMaterial({ color: '#9aadae' }),
    );
    line.position.set(w / 2, -h / 2 + 0.04, -0.025 + i * 0.032);
    notebook.add(line);
  }
  const sheet = new T.Mesh(new T.PlaneGeometry(w - 0.09, h - 0.11), paper);
  sheet.position.set(w / 2, 0, 0.166);
  notebook.add(sheet);
  const coordinates: number[] = [];
  const step = 0.32;
  for (let x = 0.2; x < w - 0.15; x += step)
    coordinates.push(x, -h / 2 + 0.15, 0.168, x, h / 2 - 0.15, 0.168);
  for (let y = -h / 2 + 0.2; y < h / 2 - 0.15; y += step)
    coordinates.push(0.15, y, 0.168, w - 0.15, y, 0.168);
  const grid = new T.LineSegments(
    new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(coordinates, 3)),
    view.ink(new T.LineBasicMaterial({ transparent: true, opacity: 0.14 }), 'ink'),
  );
  notebook.add(grid);
  const margin = new T.LineSegments(
    new T.BufferGeometry().setAttribute(
      'position',
      new T.Float32BufferAttribute([1.12, -h / 2 + 0.15, 0.169, 1.12, h / 2 - 0.15, 0.169], 3),
    ),
    view.ink(new T.LineBasicMaterial({ transparent: true, opacity: 0.3 }), 'red'),
  );
  notebook.add(margin);
  const hinge = new T.Group();
  hinge.position.set(-0.025, 0, 0.22);
  const front = board(cover, 0);
  hinge.add(front);
  notebook.add(hinge);
  const ribbon = new T.Mesh(
    new T.BoxGeometry(0.22, 1.7, 0.014),
    new T.MeshBasicMaterial({ color: '#b56c51' }),
  );
  ribbon.position.set(w * 0.73, -h / 2 - 0.5, -0.02);
  notebook.add(ribbon);
  root.add(notebook);

  const desk = new T.Mesh(
    new T.PlaneGeometry(160, 120),
    new T.MeshBasicMaterial({ color: '#687b7b' }),
  );
  desk.position.z = -0.25;
  root.add(desk);
  const joints: number[] = [];
  for (let y = -55; y < 60; y += 9) joints.push(-80, y, -0.246, 80, y, -0.246);
  root.add(
    new T.LineSegments(
      new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(joints, 3)),
      new T.LineBasicMaterial({ color: '#3d5559', transparent: true, opacity: 0.35 }),
    ),
  );
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 256;
  const c = shadowCanvas.getContext('2d')!;
  const shade = c.createRadialGradient(128, 128, 55, 128, 128, 124);
  shade.addColorStop(0, '#122a30b3');
  shade.addColorStop(1, '#122a3000');
  c.fillStyle = shade;
  c.fillRect(0, 0, 256, 256);
  const shadow = new T.Mesh(
    new T.PlaneGeometry(w * 1.55, h * 1.3),
    new T.MeshBasicMaterial({
      map: new T.CanvasTexture(shadowCanvas),
      transparent: true,
      depthWrite: false,
    }),
  );
  shadow.position.set(w / 2 + 0.12, -0.14, -0.23);
  root.add(shadow);
  const pencil = new T.Group();
  const shaft = new T.Mesh(
    new T.CylinderGeometry(0.095, 0.095, 8.5, 6),
    new T.MeshStandardMaterial({ color: '#d6a657', roughness: 0.8 }),
  );
  const wood = new T.Mesh(
    new T.CylinderGeometry(0.095, 0.018, 0.6, 6),
    new T.MeshStandardMaterial({ color: '#dfc598', roughness: 0.9 }),
  );
  wood.position.y = -4.55;
  const graphite = new T.Mesh(
    new T.CylinderGeometry(0.022, 0, 0.15, 6),
    new T.MeshStandardMaterial({ color: '#26393d', roughness: 0.8 }),
  );
  graphite.position.y = -4.925;
  pencil.add(shaft, wood, graphite);
  pencil.position.set(w + 1.35, -1.1, -0.1);
  pencil.rotation.z = -0.16;
  root.add(pencil);

  // Fit the cover's complete swept volume once, so it cannot pass through the camera.
  const envelope = new T.Box3().makeEmpty();
  for (const angle of [0, -Math.PI / 2, -Math.PI]) {
    hinge.rotation.y = angle;
    notebook.updateWorldMatrix(true, true);
    envelope.union(new T.Box3().setFromObject(notebook));
  }
  hinge.rotation.y = 0;
  envelope.union(new T.Box3().setFromObject(pencil));
  const establish = {
    target: envelope,
    direction: [3, -6, 16] as const,
    padding: 36,
  };
  let progress = 0;
  root.traverse((node) => {
    if (node instanceof T.Mesh || node instanceof T.LineSegments)
      node.userData.visualReview = () => ({
        framing:
          progress < 0.32 && (node === front || node.parent === notebook)
            ? 'subject'
            : 'background',
      });
  });
  return {
    root,
    render(value: number, aspect: number) {
      progress = clamp(value);
      const motion = bookOpening(progress);
      hinge.rotation.y = -Math.PI * motion.cover;
      const width = Math.min(w * 0.78, h * 0.76 * aspect),
        height = width / aspect;
      view.shot({
        target: new T.Box3(
          new T.Vector3(w / 2 - width / 2, -height / 2, 0.17),
          new T.Vector3(w / 2 + width / 2, height / 2, 0.17),
        ),
        direction: [0, 0, 1],
        padding: 0,
        from: establish,
        progress: motion.camera,
        reduced: false, // The chapter owner already skips the entire introduction for reduced motion.
      });
    },
  };
}
