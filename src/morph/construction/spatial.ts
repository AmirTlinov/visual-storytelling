import * as T from '../../viewport/engine.js';
import { Viewport3D } from '../../viewport/three.js';
import { inkLine, updateInkLine } from '../../viewport/ink-line.js';
import { svg } from '../../ink/dom.js';
import { paragraph } from '../../ink/paragraph.js';
import type { Surface } from '../../ink/surface.js';
import { materialDrawing, type UV } from './material.js';
import type { DiagramCamera, DiagramPanel, DiagramPoint, MaterialPatch } from './types.js';

const vector = (p: DiagramPoint) => new T.Vector3(p[0], p[1], p[2] ?? 0);
const positions = (geometry: T.BufferGeometry, points: readonly DiagramPoint[]) => {
  let attribute = geometry.getAttribute('position');
  if (!attribute || attribute.count !== points.length) {
    attribute = new T.Float32BufferAttribute(new Float32Array(points.length * 3), 3);
    geometry.setAttribute('position', attribute);
  }
  points.forEach((p, i) => attribute.setXYZ(i, p[0], p[1], p[2] ?? 0));
  attribute.needsUpdate = true;
  geometry.computeBoundingSphere();
};

/** Parametric surfaces keep fixed material topology. Depth and orbit belong to Viewport3D. */
export function spatialPanelRenderer(sheet: Surface, id: string, up?: DiagramCamera['up']) {
  const root = svg('g', { 'data-subject': id }),
    foreign = svg('foreignObject', { x: 0, y: 42, width: 400, height: 280 });
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;width:100%;height:100%';
  foreign.append(host);
  root.append(foreign);
  sheet.layer.append(root);
  const heading = paragraph(root, { size: 20 });
  const view = Viewport3D.mount(host, { up }),
    scene = new T.Group();
  view.renderer.domElement.style.cssText =
    'display:block;width:100%;height:100%;touch-action:none;cursor:grab';
  view.setObject(scene, { fitView: false });
  const objects = new Map<string, T.Mesh<T.BufferGeometry, T.MeshBasicMaterial> | T.Line2>();
  const kinds = new Map<string, 'line' | 'dashed' | 'mesh' | 'ink' | 'mark'>();
  const labels = new Map<
    string,
    { point: T.Vector3; label: ReturnType<typeof view.label>; signature: string }
  >();
  const drawings = new Map<string, ReturnType<typeof materialDrawing>>();
  let used = new Set<string>();
  function remove(id: string) {
    const object = objects.get(id);
    object?.removeFromParent();
    object?.geometry.dispose();
    object?.material.dispose();
    objects.delete(id);
    kinds.delete(id);
  }
  function line(
    id: string,
    points: readonly DiagramPoint[],
    pigment: string,
    opacity = 1,
    closed = false,
    dashed = false,
    unit = 1,
    weight = 1.8,
  ) {
    used.add(id);
    let entry = objects.get(id) as T.Line2 | undefined;
    const kind = dashed ? 'dashed' : 'line';
    if (entry && kinds.get(id) !== kind) {
      remove(id);
      entry = undefined;
    }
    if (!entry) {
      entry = inkLine(dashed);
      view.ink(entry.material, pigment);
      scene.add(entry);
      objects.set(id, entry);
      kinds.set(id, kind);
    }
    updateInkLine(entry, closed ? [...points, points[0]!] : points);
    entry.material.linewidth = weight;
    entry.material.dashSize = unit * 0.018;
    entry.material.gapSize = unit * 0.012;
    view.ink(entry.material, pigment);
    entry.material.opacity = opacity;
    entry.visible = opacity > 0;
  }
  function mesh(
    id: string,
    points: readonly DiagramPoint[],
    indices: readonly number[],
    pigment: string,
    opacity = 1,
    ink = false,
  ) {
    used.add(id);
    let entry = objects.get(id) as T.Mesh<T.BufferGeometry, T.MeshBasicMaterial> | undefined;
    const kind = ink ? 'ink' : 'mesh';
    if (entry && kinds.get(id) !== kind) {
      remove(id);
      entry = undefined;
    }
    if (!entry) {
      const material = new T.MeshBasicMaterial({
        side: ink ? T.FrontSide : T.DoubleSide,
        transparent: opacity < 1,
        vertexColors: !ink,
        polygonOffset: ink,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -3,
      });
      entry = new T.Mesh(new T.BufferGeometry(), view.ink(material, pigment));
      scene.add(entry);
      objects.set(id, entry);
      kinds.set(id, kind);
    }
    positions(entry.geometry, points);
    if (
      entry.geometry.index?.count !== indices.length ||
      indices.some((v, i) => entry!.geometry.index!.getX(i) !== v)
    )
      entry.geometry.setIndex([...indices]);
    view.ink(entry.material, pigment);
    entry.material.opacity = opacity;
    entry.material.transparent = opacity < 1;
    entry.visible = opacity > 0;
    if (!ink) {
      entry.geometry.computeVertexNormals();
      const normals = entry.geometry.getAttribute('normal');
      let colors = entry.geometry.getAttribute('color');
      if (!colors || colors.count !== points.length) {
        colors = new T.Float32BufferAttribute(new Float32Array(points.length * 3), 3);
        entry.geometry.setAttribute('color', colors);
      }
      const light = new T.Vector3(-0.35, 0.6, 1).normalize();
      for (let i = 0; i < points.length; i++) {
        const shade =
          0.84 +
          0.16 *
            Math.abs(
              normals.getX(i) * light.x + normals.getY(i) * light.y + normals.getZ(i) * light.z,
            );
        colors.setXYZ(i, shade, shade, shade);
      }
      colors.needsUpdate = true;
    }
  }
  function material(patch: MaterialPatch) {
    const [[x0, y0], [x1, y1]] = patch.domain,
      nu = 64,
      nv = 40;
    if (patch.fill !== false) {
      const points: DiagramPoint[] = [],
        indices: number[] = [];
      for (let j = 0; j <= nv; j++)
        for (let i = 0; i <= nu; i++)
          points.push(patch.map([x0 + ((x1 - x0) * i) / nu, y0 + ((y1 - y0) * j) / nv]));
      for (let j = 0; j < nv; j++)
        for (let i = 0; i < nu; i++) {
          const a = j * (nu + 1) + i,
            b = a + nu + 1;
          indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
      mesh(patch.id, points, indices, `${patch.pigment}-soft`, patch.opacity);
    }
    let drawing = drawings.get(patch.id);
    if (!drawing) {
      drawing = materialDrawing();
      drawings.set(patch.id, drawing);
    }
    const art = drawing(patch);
    line(
      `${patch.id}-boundary`,
      art.boundary.map(patch.map),
      'pencil',
      patch.opacity,
      true,
      false,
      1,
      1,
    );
    art.grid.forEach((points, i) =>
      line(
        `${patch.id}-grid-${i}`,
        points.map(patch.map),
        patch.pigment,
        (patch.opacity ?? 1) * 0.3,
        false,
        false,
        1,
        0.85,
      ),
    );
    art.strokes.forEach((stroke, index) => {
      const vertices: DiagramPoint[] = [],
        indices: number[] = [];
      const at = (uv: UV) =>
        patch.map([Math.max(x0, Math.min(x1, uv[0])), Math.max(y0, Math.min(y1, uv[1]))]);
      stroke.forEach((p, i) => {
        const before = stroke[Math.max(0, i - 1)]!,
          after = stroke[Math.min(stroke.length - 1, i + 1)]!;
        const dx = after[0] - before[0],
          dy = after[1] - before[1],
          length = Math.hypot(dx, dy) || 1;
        const ox = ((-dy / length) * art.weight) / 2,
          oy = ((dx / length) * art.weight) / 2;
        vertices.push(at([p[0] + ox, p[1] + oy]), at([p[0] - ox, p[1] - oy]));
        if (i) {
          const a = i * 2;
          indices.push(a - 2, a - 1, a, a, a - 1, a + 1);
        }
      });
      mesh(`${patch.id}-ink-${index}`, vertices, indices, 'ink', patch.opacity, true);
    });
  }
  return {
    render(
      panel: DiagramPanel,
      x: number,
      y: number,
      width: number,
      height: number,
      layout: { order: string[]; camera?: DiagramCamera },
    ) {
      used = new Set();
      root.setAttribute('transform', `translate(${x} ${y})`);
      const head = heading.render(panel.title, width - 12, width / 2, 23),
        top = head + 34;
      foreign.setAttribute('y', String(top));
      foreign.setAttribute('width', String(width));
      foreign.setAttribute('height', String(height - top));
      for (const patch of panel.patches ?? []) material(patch);
      for (const path of panel.paths ?? []) {
        // Curves retain their mathematical geometry; hidden segments use the shared depth buffer.
        line(
          path.id,
          path.points,
          path.pigment ?? 'ink',
          (path.opacity ?? 1) * (path.quiet ? 0.35 : 1),
          path.closed,
          path.dashed,
          vector(panel.bounds[1]).sub(vector(panel.bounds[0])).length(),
          path.quiet ? 1 : 1.8,
        );
        if (path.fill && path.points.length >= 3) {
          const vertices = path.points;
          const normal = new T.Vector3();
          vertices.forEach((p, i) =>
            normal.add(vector(p).cross(vector(vertices[(i + 1) % vertices.length]!))),
          );
          const largest = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)].indexOf(
            Math.max(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)),
          );
          const contour = vertices.map((p) => {
            const xy = [p[0], p[1], p[2] ?? 0].filter((_, axis) => axis !== largest);
            return new T.Vector2(xy[0]!, xy[1]!);
          });
          const indices = T.ShapeUtils.triangulateShape(contour, []).flat();
          mesh(
            `${path.id}-fill`,
            vertices,
            indices,
            `${path.pigment ?? 'blue'}-soft`,
            path.opacity,
          );
        }
        if (path.arrow && path.points.length > 1) {
          const a = vector(path.points.at(-2)!),
            b = vector(path.points.at(-1)!),
            d = b.clone().sub(a),
            length = d.length();
          if (length > 1e-8) {
            d.normalize();
            const side = d.clone().cross(new T.Vector3(0, 0, 1));
            if (side.length() < 0.01) side.copy(d).cross(new T.Vector3(0, 1, 0));
            side.normalize();
            const r = Math.min(
              length * 0.18,
              vector(panel.bounds[1]).sub(vector(panel.bounds[0])).length() * 0.025,
            );
            const p = b
                .clone()
                .addScaledVector(d, -r)
                .addScaledVector(side, r * 0.4),
              q = b
                .clone()
                .addScaledVector(d, -r)
                .addScaledVector(side, -r * 0.4);
            line(
              `${path.id}-tip`,
              [
                [p.x, p.y, p.z],
                [b.x, b.y, b.z],
                [q.x, q.y, q.z],
              ],
              path.pigment ?? 'ink',
              path.opacity,
            );
          }
        }
      }
      for (const mark of panel.marks ?? []) {
        used.add(mark.id);
        let entry = objects.get(mark.id) as
          | T.Mesh<T.BufferGeometry, T.MeshBasicMaterial>
          | undefined;
        if (entry && kinds.get(mark.id) !== 'mark') {
          remove(mark.id);
          entry = undefined;
        }
        if (!entry) {
          entry = new T.Mesh(
            new T.SphereGeometry(1, 16, 12),
            view.ink(new T.MeshBasicMaterial(), mark.pigment ?? 'blue'),
          );
          scene.add(entry);
          objects.set(mark.id, entry);
          kinds.set(mark.id, 'mark');
        }
        view.ink(entry.material, mark.pigment ?? 'blue');
        entry.position.copy(vector(mark.at));
        entry.scale.setScalar(
          vector(panel.bounds[1]).sub(vector(panel.bounds[0])).length() * 0.009,
        );
        entry.visible = (mark.opacity ?? 1) > 0;
        entry.material.opacity = mark.opacity ?? 1;
        entry.material.transparent = true;
      }
      const shown = new Set<string>();
      for (const item of panel.labels ?? []) {
        shown.add(item.id);
        let entry = labels.get(item.id);
        const order = layout.order.indexOf(item.id);
        const signature = `${item.pigment}/${item.side}/${order}`;
        if (entry && entry.signature !== signature) {
          entry.label.remove();
          labels.delete(item.id);
          entry = undefined;
        }
        if (!entry) {
          const point = new T.Vector3(),
            side = item.side ?? 'top';
          const label = view.label(
            item.text,
            { object: scene, position: point },
            {
              avoidOverlap: true,
              order,
              tone: item.pigment ?? 'ink',
              size: 18,
              offset:
                side === 'left'
                  ? [-35, 0]
                  : side === 'right'
                    ? [35, 0]
                    : side === 'bottom'
                      ? [0, 23]
                      : [0, -23],
            },
          );
          entry = { point, label, signature };
          labels.set(item.id, entry);
        }
        entry.point.copy(vector(item.at));
        if (item.to) {
          entry.point.add(vector(item.to)).multiplyScalar(0.5);
          line(
            `measure-${item.id}`,
            [item.at, item.to],
            item.pigment ?? 'ink',
            (item.opacity ?? 1) * 0.5,
          );
        }
        entry.label.set(item.text);
        entry.label.opacity(item.opacity ?? 1);
      }
      for (const [key, entry] of labels)
        if (!shown.has(key)) {
          entry.label.remove();
          labels.delete(key);
        }
      for (const key of objects.keys()) if (!used.has(key)) remove(key);
      for (const key of drawings.keys())
        if (!panel.patches?.some((p) => p.id === key)) drawings.delete(key);
      view.shot({
        target: new T.Box3(vector(panel.bounds[0]), vector(panel.bounds[1])),
        direction: layout.camera?.direction,
        padding: 18,
      });
      view.invalidate();
      return height;
    },
    reset: () => view.reset(),
    dispose() {
      heading.dispose();
      view.dispose();
      root.remove();
      objects.clear();
      kinds.clear();
      labels.clear();
      drawings.clear();
    },
  };
}
