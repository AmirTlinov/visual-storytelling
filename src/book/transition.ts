import * as T from '../viewport/engine.js';
import { Viewport3D } from '../viewport/three.js';
import { coverTexture } from './cover.js';
import { paperSize, type PaperPage } from './paper.js';
import type { BookState } from './stage.js';
const clamp = (n: number) => Math.max(0, Math.min(1, n));

/** Ephemeral narrative scenery; it never owns exploration or the story clock. */
export function bookTransition(
  parent: HTMLElement,
  options: { topic: string; current: PaperPage; previous: PaperPage },
) {
  const view = Viewport3D.mount(parent, { label: `Tlinov · ${options.topic}` });
  view.controls.enabled = false;
  view.renderer.domElement.tabIndex = -1;
  view.renderer.domElement.style.cssText = 'width:100%;height:100%;pointer-events:none';
  const root = new T.Group(),
    { width: w, height: h } = paperSize;
  const texture = (canvas: HTMLCanvasElement) => {
    const t = new T.CanvasTexture(canvas);
    t.colorSpace = T.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  const currentMap = texture(options.current.canvas),
    previousMap = texture(options.previous.canvas);
  const blank = document.createElement('canvas');
  blank.width = blank.height = 2;
  const blankMap = texture(blank),
    coverMap = texture(coverTexture(options.topic));
  const leather = new T.MeshStandardMaterial({ color: '#19383b', roughness: 0.83 });
  const gilding = new T.MeshStandardMaterial({
    color: '#bd9b57',
    roughness: 0.55,
    metalness: 0.35,
  });
  const pageEdge = new T.MeshStandardMaterial({ color: '#c5c5c2', roughness: 0.95 });
  const cover = new T.MeshBasicMaterial({ map: coverMap });
  const inside = view.ink(new T.MeshBasicMaterial(), 'surface');
  const board = (x: number, z: number) => {
    const mesh = new T.Mesh(new T.BoxGeometry(w + 0.35, h + 0.35, 0.16), [
      leather,
      leather,
      leather,
      leather,
      cover,
      inside,
    ]);
    mesh.position.set(x, 0, z);
    return mesh;
  };
  const back = board(w / 2, -0.14);
  root.add(back);
  const stack = new T.Mesh(new T.BoxGeometry(w - 0.1, h - 0.12, 0.43), [
    pageEdge,
    pageEdge,
    pageEdge,
    pageEdge,
    inside,
    pageEdge,
  ]);
  stack.position.set(w / 2, 0, 0.15);
  root.add(stack);
  // Thin page edges and a stitched spine make the volume readable during the flight.
  for (let i = 0; i < 13; i++) {
    const edge = new T.Mesh(new T.BoxGeometry(w - 0.04, 0.015, 0.013), gilding);
    edge.position.set(w / 2, -h / 2 + 0.025, 0.01 + i * 0.029);
    root.add(edge);
  }
  const hinge = new T.Group();
  hinge.position.set(0, 0, 0.46);
  const front = board(w / 2, 0.03);
  hinge.add(front);
  root.add(hinge);
  for (const y of [-h * 0.37, 0, h * 0.37]) {
    const band = new T.Mesh(new T.BoxGeometry(0.22, 0.15, 0.66), gilding);
    band.position.set(-0.08, y, 0.13);
    root.add(band);
  }
  const leaf = (x: number, map: T.CanvasTexture) => {
    const mesh = new T.Mesh(
      new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({ map, side: T.DoubleSide, transparent: true }),
    );
    mesh.position.set(x, 0, 0.395);
    return mesh;
  };
  const right = leaf(w / 2, currentMap),
    left = leaf(-w / 2, blankMap);
  root.add(right, left);
  // During the curl, occlude the next drawing with the host surface pigment.
  // The ordinary worksheet remains a transparent canvas.
  const leafSurface = view.ink(new T.MeshBasicMaterial({ side: T.DoubleSide }), 'surface');
  const rightPaper = new T.Mesh(right.geometry, leafSurface);
  rightPaper.position.copy(right.position);
  rightPaper.position.z -= 0.002;
  root.add(rightPaper);
  const turnGeometry = new T.PlaneGeometry(w, h, 48, 1);
  const turning = new T.Mesh(
    turnGeometry,
    new T.MeshBasicMaterial({ map: currentMap, side: T.FrontSide, transparent: true }),
  );
  turning.position.z = 0.42;
  const turnPaper = new T.Mesh(turnGeometry, leafSurface);
  turnPaper.position.z = 0.419;
  root.add(turning, turnPaper);
  view.setObject(root);
  const box = (x0: number, x1: number, z = 0.6) =>
    new T.Box3(new T.Vector3(x0, -h / 2 - 0.25, -0.25), new T.Vector3(x1, h / 2 + 0.25, z));
  const spread = { target: box(-w - 0.3, w + 0.3), direction: [0, 0.13, 10] as const, padding: 22 };
  const detail = {
    target: new T.Box3(new T.Vector3(0, -h / 2, 0.395), new T.Vector3(w, h / 2, 0.395)),
    direction: [0, 0, 10] as const,
    padding: 0,
  };
  let state: BookState | undefined;
  root.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    node.userData.visualReview = () => ({
      framing:
        state && state.open >= 1 && node !== right && !(turning.visible && node === turning)
          ? 'background'
          : 'subject',
    });
  });
  const render = (next: BookState) => {
    if (!Number.isInteger(next.page) || next.page < 0) throw new Error('Unknown book page');
    if (![next.time, next.progress, next.open, next.focus, next.turn].every(Number.isFinite))
      throw new Error('Book state must be finite');
    state = { ...next };
    const open = next.reduced ? Number(next.open > 0) : clamp(next.open),
      turn = next.reduced ? 1 : clamp(next.turn);
    currentMap.needsUpdate = true;
    if (next.page > 0) previousMap.needsUpdate = true;
    hinge.rotation.y = -Math.PI * open;
    left.visible = open > 0.55;
    right.material.map = currentMap;
    left.material.map = next.page > 0 && turn >= 1 ? previousMap : blankMap;
    const flipping = next.page > 0 && turn < 1;
    turnPaper.visible = flipping;
    // Beyond the vertical, only the blank back of the departing leaf is visible.
    turning.visible = flipping && turn < 0.5;
    if (flipping) {
      turning.material.map = previousMap;
      const points = turnGeometry.getAttribute('position'),
        uv = turnGeometry.getAttribute('uv'),
        angle = Math.PI * turn;
      for (let i = 0; i < points.count; i++) {
        const u = uv.getX(i),
          v = uv.getY(i),
          curl = Math.sin(Math.PI * u) * Math.sin(angle) * 0.65;
        points.setXYZ(i, u * w * Math.cos(angle), (v - 0.5) * h, u * w * Math.sin(angle) + curl);
      }
      points.needsUpdate = true;
      turnGeometry.computeBoundingBox();
      turnGeometry.computeBoundingSphere();
    }
    // Only the opening and a turning leaf use the 3D viewport.
    const intro = next.focus < 1;
    for (const mesh of [back, stack, hinge]) mesh.visible = intro;
    left.visible = intro && open > 0.55;
    for (const node of root.children)
      if (
        node !== right &&
        node !== left &&
        node !== turning &&
        node !== turnPaper &&
        node !== rightPaper &&
        node !== back &&
        node !== stack &&
        node !== hinge
      )
        node.visible = intro;
    if (open < 1) {
      root.updateWorldMatrix(true, true);
      const visible = new T.Box3().makeEmpty();
      root.traverseVisible((node) => {
        if (node instanceof T.Mesh) {
          node.geometry.computeBoundingBox();
          visible.union(node.geometry.boundingBox!.clone().applyMatrix4(node.matrixWorld));
        }
      });
      const settle = clamp((open - 0.9) / 0.1);
      view.shot({
        ...spread,
        from: {
          target: visible,
          direction: [2 * (1 - open), 1.4 * (1 - open) + 0.13 * open, 9 + open],
          padding: 28,
        },
        progress: settle * settle * (3 - 2 * settle),
      });
    } else
      view.shot({
        ...detail,
        from: spread,
        progress: next.focus * (flipping ? 1 - 0.95 * Math.sin(Math.PI * turn) : 1),
        reduced: next.reduced,
      });
    view.invalidate();
  };
  view.onDispose(() => {
    const active = new Set<T.CanvasTexture>();
    root.traverse((node) => {
      if (node instanceof T.Mesh)
        for (const m of Array.isArray(node.material) ? node.material : [node.material])
          if ('map' in m && m.map) active.add(m.map as T.CanvasTexture);
    });
    for (const map of [currentMap, previousMap, blankMap, coverMap])
      if (!active.has(map)) map.dispose();
  });
  return { render, dispose: view.dispose };
}
