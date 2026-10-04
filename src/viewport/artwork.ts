import {
  Box3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShapeGeometry,
  Vector3,
} from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import type { Viewport3DHandle } from './three.js';

export interface SvgArtworkOptions {
  /** Fit the visible artwork, preserving its proportions. World units. */
  width?: number;
  height?: number;
  /** Original SVG colours → the viewport's semantic pigments, e.g. '#000000': 'ink'. */
  colors?: Record<string, string>;
}

/** Ready-made vector artwork remains geometry: it follows its parent, camera and theme.
 * Load source text once; create an instance for each subject. Viewport3D disposes its meshes. */
function create(view: Viewport3DHandle, source: string, options: SvgArtworkOptions = {}) {
  const parsed = new SVGLoader().parse(source);
  const root = new Group(),
    drawing = new Group();
  const materials = new Map<MeshBasicMaterial, number>();
  const layers = new Map<string, Mesh[]>();
  const colors = new Map(
    Object.entries(options.colors ?? {}).map(([color, tone]) => [
      new Color(color).getHexString(),
      tone,
    ]),
  );
  let order = 0;
  root.add(drawing);
  function paint(color: string, opacity: number) {
    let material: MeshBasicMaterial | undefined;
    return () => {
      if (!material) {
        material = new MeshBasicMaterial({
          color,
          side: DoubleSide,
          transparent: true,
          depthWrite: false,
          opacity,
        });
        materials.set(material, opacity);
        const tone = colors.get(material.color.getHexString());
        if (tone) view.ink(material, tone);
      }
      return material;
    };
  }
  try {
    for (const path of parsed.paths) {
      const style = path.userData!.style;
      const add = (
        geometry: ShapeGeometry | ReturnType<typeof SVGLoader.pointsToStroke>,
        material: () => MeshBasicMaterial,
      ) => {
        if (!geometry) return;
        if ((geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0) < 3) {
          geometry.dispose();
          return;
        }
        let mesh: Mesh;
        try {
          mesh = new Mesh(geometry, material());
        } catch (error) {
          geometry.dispose();
          throw error;
        }
        mesh.name = path.userData!.node.id;
        mesh.renderOrder = order++;
        drawing.add(mesh);
        for (let node: Element | null = path.userData!.node; node; node = node.parentElement) {
          if (!node.id) continue;
          if (!layers.has(node.id)) layers.set(node.id, []);
          layers.get(node.id)!.push(mesh);
        }
      };
      if (style.fill !== undefined && style.fill !== 'none') {
        const material = paint(style.fill, (style.fillOpacity ?? 1) * (style.opacity ?? 1));
        for (const shape of path.toShapes(false)) add(new ShapeGeometry(shape, 24), material);
      }
      if (style.stroke !== undefined && style.stroke !== 'none') {
        const material = paint(style.stroke, (style.strokeOpacity ?? 1) * (style.opacity ?? 1));
        for (const subpath of path.subPaths)
          add(SVGLoader.pointsToStroke(subpath.getPoints(36), style), material);
      }
    }
    if (!drawing.children.length) throw new Error('SVG artwork has no drawable paths');
  } catch (error) {
    for (const mesh of drawing.children as Mesh[]) mesh.geometry.dispose();
    for (const material of materials.keys()) material.dispose();
    throw error;
  }
  drawing.scale.y = -1;
  const bounds = new Box3().setFromObject(drawing),
    size = bounds.getSize(new Vector3());
  const scale = Math.min(
    options.width ? options.width / size.x : Infinity,
    options.height ? options.height / size.y : Infinity,
  );
  drawing.position.sub(bounds.getCenter(new Vector3()));
  root.scale.setScalar(Number.isFinite(scale) ? scale : 1);
  return {
    root,
    /** Meshes belonging to each named SVG element or group, in source coordinates. */
    layers,
    opacity(value: number) {
      root.visible = value > 0;
      for (const [material, opacity] of materials)
        material.opacity = opacity * Math.max(0, Math.min(1, value));
    },
  };
}

export const SvgArtwork3D = { create };
