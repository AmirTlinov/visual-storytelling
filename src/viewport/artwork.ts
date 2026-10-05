import {
  Box3,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  ShapeGeometry,
  Sphere,
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
  for (const name of ['width', 'height'] as const) {
    const value = options[name];
    if (value !== undefined && (!Number.isFinite(value) || value <= 0))
      throw new Error(`SVG artwork ${name} must be finite and positive`);
  }
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
  root.add(drawing);
  function paint(color: string, opacity: number) {
    let material: MeshBasicMaterial | undefined;
    return () => {
      if (!material) {
        if (!Number.isFinite(opacity)) throw new Error('SVG artwork opacity must be finite');
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
          const positions = geometry.getAttribute('position');
          if (!positions.array.every(Number.isFinite))
            throw new Error('SVG artwork coordinates must be finite');
          geometry.computeBoundingBox();
          const bounds = geometry.boundingBox!;
          if (bounds.max.x <= bounds.min.x || bounds.max.y <= bounds.min.y) {
            geometry.dispose();
            return;
          }
          mesh = new Mesh(geometry, material());
        } catch (error) {
          geometry.dispose();
          throw error;
        }
        mesh.name = path.userData!.node.id;
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
    const bounds = new Box3().setFromObject(drawing),
      size = bounds.getSize(new Vector3());
    // A coplanar illustration has one sorting centre. Per-path centres would
    // reorder its paint when the camera turns; global renderOrder would instead
    // draw details of a distant illustration over a closer one. Equal depth keeps
    // Three's stable source/mesh order, while whole illustrations sort by depth.
    const sphere = bounds.getBoundingSphere(new Sphere());
    for (const mesh of drawing.children as Mesh[]) mesh.geometry.boundingSphere = sphere.clone();
    const scale = Math.min(
      options.width !== undefined ? options.width / size.x : Infinity,
      options.height !== undefined ? options.height / size.y : Infinity,
    );
    const fit = Number.isFinite(scale) ? scale : 1;
    drawing.scale.set(fit, -fit, fit);
    drawing.position.copy(bounds.getCenter(new Vector3())).multiply(drawing.scale).negate();
  } catch (error) {
    for (const mesh of drawing.children as Mesh[]) mesh.geometry.dispose();
    for (const material of materials.keys()) material.dispose();
    throw error;
  }
  return {
    /** Centred, fitted artwork. Its transform is entirely available for animation. */
    root,
    /** Meshes belonging to each named SVG element or group, in source coordinates. */
    layers,
    opacity(value: number) {
      if (!Number.isFinite(value)) throw new Error('SVG artwork opacity must be finite');
      const alpha = Math.max(0, Math.min(1, value));
      drawing.visible = alpha > 0;
      for (const [material, opacity] of materials) material.opacity = opacity * alpha;
      view.invalidate();
    },
  };
}

export const SvgArtwork3D = { create };
