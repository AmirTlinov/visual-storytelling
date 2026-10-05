import type { FrameBox } from '../characters/staging/camera.js';
import type { Furniture, GroundPoint, Projection } from '../characters/staging/types.js';
import { furnitureParts } from '../characters/staging/furniture.js';
import { coverTexture } from './cover.js';
import { notebookCamera } from './camera.js';
import * as T from '../viewport/engine.js';
import type { Viewport3DHandle } from '../viewport/three.js';
import { inkLine, updateInkLine } from '../viewport/ink-line.js';
import { stageInk } from '../characters/staging/geometry.js';

export interface NotebookSource {
  image: HTMLCanvasElement;
  width: number;
  height: number;
  camera: FrameBox;
  projection: Projection;
  book: Furniture;
  support: Furniture;
}

/** All binding, cover and furniture vertices stay in the stage's metres under one camera. */
export function notebookOpening(view: Viewport3DHandle, topic: string) {
  const root = new T.Group();
  root.name = 'notebook-entry';
  const material = (fill: string) => new T.MeshBasicMaterial({ color: fill, side: T.DoubleSide });
  const paper = view.ink(new T.MeshBasicMaterial({ side: T.BackSide }), 'surface');
  const texture = (image: HTMLCanvasElement) => {
    const map = new T.CanvasTexture(image);
    map.colorSpace = T.SRGBColorSpace;
    map.anisotropy = 8;
    return map;
  };
  const coverMap = texture(coverTexture(topic)),
    pageMap = texture(document.createElement('canvas')),
    roomMap = texture(document.createElement('canvas'));
  const coverMaterial = new T.MeshBasicMaterial({ map: coverMap, side: T.FrontSide });
  const pageMaterial = new T.MeshBasicMaterial({
    map: pageMap,
    transparent: true,
    side: T.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const roomMaterial = new T.MeshBasicMaterial({ map: roomMap, side: T.DoubleSide });
  const mesh = (name: string, paint: T.MeshBasicMaterial) => {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(new Array(12).fill(0), 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    geometry.setIndex([0, 2, 1, 0, 3, 2]);
    const result = new T.Mesh(geometry, paint);
    result.name = name;
    result.userData.visualReview = () => ({ framing: 'background' });
    root.add(result);
    return result;
  };
  const room = mesh('historical-room', roomMaterial),
    sheet = mesh('paper-ink', pageMaterial),
    front = mesh('cover', coverMaterial),
    inside = mesh('inside-cover', paper);
  const solids: T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>[] = [];
  let framed = false;
  for (const subject of [sheet, front, inside])
    subject.userData.visualReview = () => ({
      framing: framed ? 'subject' : 'background',
      source: 'notebook',
    });
  const geometry = (mesh: T.Mesh, points: readonly GroundPoint[]) => {
    const position = mesh.geometry.getAttribute('position');
    points.forEach((p, i) => position.setXYZ(i, p.x, p.height ?? 0, -p.z));
    position.needsUpdate = true;
    mesh.geometry.computeBoundingBox();
    mesh.geometry.computeBoundingSphere();
  };
  let index = 0;
  const solid = (name: string, points: readonly GroundPoint[], fill: string, stroke = 0.6) => {
    let node = solids[index];
    if (!node) {
      node = mesh(name, material(fill));
      const line = inkLine(false);
      line.material.color.set(stageInk);
      line.userData.visualReview = () => ({ framing: 'background' });
      node.add(line);
      solids.push(node);
    }
    node.name = name;
    node.visible = true;
    node.material.color.set(fill);
    geometry(node, points);
    const line = node.children[0] as T.Line2;
    line.visible = stroke > 0;
    line.material.linewidth = (stroke * (view.renderer.domElement.clientWidth || 960)) / 960;
    updateInkLine(
      line,
      [...points, points[0]!].map((p) => [p.x, p.height ?? 0, -p.z]),
    );
    index++;
  };
  let previousSource: NotebookSource | undefined, previousPage: HTMLCanvasElement | undefined;
  return {
    root,
    render(
      progress: number,
      source: NotebookSource,
      page: HTMLCanvasElement | { liveAspect: number },
    ) {
      // At the close establishing pose the complete book must fit. The later orbit enters it.
      framed = progress >= 0.64 && progress <= 0.68;
      const live = 'liveAspect' in page;
      const { model, project } = notebookCamera(
        source,
        progress,
        live ? page.liveAspect : undefined,
      );
      view.shot(project);
      if (source !== previousSource) {
        roomMap.image = source.image;
        roomMap.needsUpdate = true;
        previousSource = source;
      }
      sheet.visible = !live;
      if (!live && page !== previousPage) {
        pageMap.image = page;
        pageMap.needsUpdate = true;
        previousPage = page;
      }
      // A single historical backdrop stays rigid; the physical support and book retain depth.
      const s = source.projection,
        z = source.book.at.z + 6,
        scale = s.distance / (s.distance + z);
      const at = (x: number, y: number): GroundPoint => ({
        x: (x - s.center) / (s.unit * scale),
        z,
        height: (s.floor - s.horizon - (y - s.horizon) / scale) / s.unit,
      });
      geometry(room, [
        at(0, 0),
        at(source.width, 0),
        at(source.width, source.height),
        at(0, source.height),
      ]);
      index = 0;
      for (const part of furnitureParts(source.support, s))
        for (const face of part.polygons) solid('support', face.world, face.fill, face.stroke);
      for (const face of model.faces)
        if (face.name !== 'page')
          solid(
            `binding-${face.name}`,
            face.points,
            face.fill === '#f5f5ef' ? view.palette.surface!.getStyle() : face.fill,
            ['paper', 'spine'].includes(face.name) ? 0 : 0.6,
          );
      solid(
        'hinge',
        [model.front[0], model.page[0], model.page[3], model.front[3]],
        view.palette.surface!.getStyle(),
        0,
      );
      for (let i = index; i < solids.length; i++) solids[i]!.visible = false;
      // Expanded Ink captures fill the paper; arbitrary chapter captures retain their aspect.
      if (!live) geometry(sheet, model.content(page.width / page.height));
      geometry(front, model.front);
      geometry(inside, model.front);
      return model;
    },
  };
}
