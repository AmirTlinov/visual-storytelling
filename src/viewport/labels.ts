import * as T from './engine.js';
import {
  bounds,
  contains,
  inflate,
  overlaps,
  rectInPolygon,
  boundary,
  pathData,
  route,
  type Rect,
  type Point2,
} from '../layout/geometry.js';

export interface FaceAnchor {
  object: T.Object3D;
  /** Ordered corners in the object's local coordinates. */
  corners: () => readonly T.Vector3[];
}
export interface LabelOptions {
  id?: string;
  tone?: string;
  size?: number;
  minSize?: number;
  offset?: [number, number];
  visible?: () => boolean;
  priority?: () => number;
  face?: FaceAnchor;
  occlude?: boolean;
  wrap?: () => number;
  /** Grammar-bearing symbols retain their authored place in an expression. */
  placement?: 'auto' | 'fixed';
}
export interface ReadabilityIssue {
  id: string;
  text: string;
  reason: 'no-space';
}
const svg = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS('http://www.w3.org/2000/svg', tag);
const visible = (object: T.Object3D) => {
  for (let o: T.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
  return true;
};
type Item = {
  id: string;
  element: HTMLSpanElement;
  leader: SVGPathElement;
  point: () => T.Vector3;
  options: LabelOptions;
  measured?: { key: string; sizes: Map<number, { width: number; height: number }> };
};

/** Sole owner of world-to-screen lettering, face containment and callout placement. */
export class ProjectedLabels {
  private items = new Set<Item>();
  private obstacles = new Set<T.Object3D>();
  private serial = 0;
  private ray = new T.Raycaster();
  private solids: T.Object3D[] = [];
  private overlay = svg('svg');
  private issues: ReadabilityIssue[] = [];
  private occupied: Rect[] = [];
  private width = 1;
  private height = 1;
  constructor(
    private stage: HTMLElement,
    private camera: T.PerspectiveCamera,
    private scene: T.Scene,
    private invalidate: () => void,
  ) {
    this.overlay.classList.add('ve-label-leaders');
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none';
    this.overlay.setAttribute('aria-hidden', 'true');
    stage.append(this.overlay);
  }
  add(text: string, point: () => T.Vector3, options: LabelOptions = {}) {
    const element = document.createElement('span');
    element.className = 've-label';
    element.textContent = text;
    element.dataset.tone = options.tone ?? 'ink';
    element.dataset.label = options.id ?? `label-${++this.serial}`;
    const leader = svg('path');
    leader.setAttribute('fill', 'none');
    leader.setAttribute('stroke', 'var(--ve-pencil)');
    leader.setAttribute('stroke-width', '1');
    this.stage.append(element);
    this.overlay.append(leader);
    const item: Item = { id: element.dataset.label!, element, leader, point, options };
    this.items.add(item);
    this.invalidate();
    return {
      element,
      remove: () => {
        this.items.delete(item);
        element.remove();
        leader.remove();
        this.invalidate();
      },
    };
  }
  avoid(object: T.Object3D) {
    this.obstacles.add(object);
    return () => this.obstacles.delete(object);
  }
  private project(v: T.Vector3) {
    const q = v.clone().project(this.camera);
    return {
      x: ((q.x + 1) * this.width) / 2,
      y: ((1 - q.y) * this.height) / 2,
      z: q.z,
    };
  }
  private occluded(point: T.Vector3) {
    const direction = point.clone().sub(this.camera.position),
      distance = direction.length();
    this.ray.set(this.camera.position, direction.normalize());
    this.ray.far = Math.max(0, distance - 0.012);
    return this.ray.intersectObjects(this.solids, false).length > 0;
  }
  private faceUncovered(box: Rect, object: T.Object3D) {
    this.ray.far = Infinity;
    return [
      [box.x, box.y],
      [box.x + box.width, box.y],
      [box.x + box.width, box.y + box.height],
      [box.x, box.y + box.height],
    ].every(([x, y]) => {
      this.ray.setFromCamera(
        new T.Vector2((x! / this.width) * 2 - 1, 1 - (y! / this.height) * 2),
        this.camera,
      );
      const hit = this.ray.intersectObjects(this.solids, false)[0];
      return !hit || hit.object === object;
    });
  }
  render() {
    const width = this.stage.clientWidth,
      height = this.stage.clientHeight;
    this.width = width;
    this.height = height;
    this.solids = [];
    this.scene.traverse((node) => {
      const mesh = node as T.Mesh;
      if (!mesh.isMesh || !visible(mesh) || mesh.userData.labelOccluder === false) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      if (materials.some((m) => m.visible && m.opacity > 0.2)) this.solids.push(mesh);
    });
    this.overlay.setAttribute('viewBox', `0 0 ${width} ${height}`);
    this.issues = [];
    this.occupied = [];
    const screen = { x: 8, y: 8, width: Math.max(0, width - 16), height: Math.max(0, height - 16) };
    const bodies = [...this.obstacles].filter(visible).map((object) => {
      const box = new T.Box3().setFromObject(object),
        points: T.Vector3[] = [];
      for (const x of [box.min.x, box.max.x])
        for (const y of [box.min.y, box.max.y])
          for (const z of [box.min.z, box.max.z]) points.push(new T.Vector3(x, y, z));
      return bounds(points.map((p) => this.project(p)));
    });
    const items = [...this.items].sort(
      (a, b) => (b.options.priority?.() ?? 0) - (a.options.priority?.() ?? 0),
    );
    for (const item of items) {
      const { element, options, leader } = item;
      leader.style.display = 'none';
      const hide = () => {
        element.hidden = true;
        element.dataset.placement = 'hidden';
      };
      if (options.visible && !options.visible()) {
        hide();
        continue;
      }
      if (options.face && !visible(options.face.object)) {
        hide();
        continue;
      }
      const world = item.point(),
        anchor = this.project(world);
      if (anchor.z <= -1 || anchor.z >= 1) {
        hide();
        continue;
      }
      if (options.occlude && this.occluded(world)) {
        hide();
        continue;
      }
      let polygon: Point2[] | undefined;
      if (options.face) {
        const corners = options.face
          .corners()
          .map((p) => options.face!.object.localToWorld(p.clone()));
        const normal = corners[1]!
          .clone()
          .sub(corners[0]!)
          .cross(corners[2]!.clone().sub(corners[1]!))
          .normalize();
        if (normal.dot(this.camera.position.clone().sub(world).normalize()) < 0.15) {
          hide();
          continue;
        }
        polygon = corners.map((p) => this.project(p));
      }
      if (options.wrap) {
        element.style.maxWidth = `${Math.max(80, Math.round(options.wrap()))}px`;
        element.style.minWidth = 'min-content';
        element.style.whiteSpace = 'normal';
        element.style.textAlign = 'center';
      }
      element.hidden = false;
      element.classList.toggle('ve-face-label', !!polygon);
      element.classList.remove('ve-label-callout');
      const preferred = options.size ?? 18,
        min = options.minSize ?? preferred;
      const key = `${element.textContent}|${element.style.maxWidth}`;
      if (item.measured?.key !== key) item.measured = { key, sizes: new Map() };
      const measure = (size: number) => {
        let measured = item.measured!.sizes.get(size);
        if (!measured) {
          element.style.fontSize = `${size}px`;
          measured = { width: element.offsetWidth, height: element.offsetHeight };
          item.measured!.sizes.set(size, measured);
        }
        return measured;
      };
      let { width: w, height: h } = measure(preferred),
        chosenSize = preferred;
      const positioned = (x: number, y: number): Rect => ({
        x: x - w / 2,
        y: y - h / 2,
        width: w,
        height: h,
      });
      let chosen: Rect | undefined,
        placement = 'anchor';
      const offset = options.offset ?? [0, 0];
      if (polygon) {
        for (let size = preferred; size >= min; size--) {
          ({ width: w, height: h } = measure(size));
          const box = positioned(anchor.x, anchor.y);
          if (
            contains(screen, box) &&
            rectInPolygon(box, polygon, 3) &&
            !this.occupied.some((r) => overlaps(box, r, 3)) &&
            (!options.occlude || this.faceUncovered(box, options.face!.object))
          ) {
            chosen = box;
            placement = 'face';
            chosenSize = size;
            break;
          }
        }
      }
      if (!chosen) {
        ({ width: w, height: h } = measure(preferred));
        const step = h + 10,
          faceBox = polygon ? bounds(polygon) : undefined;
        const reach = faceBox
          ? Math.max(faceBox.width, faceBox.height) / 2 + Math.max(w, h) / 2 + 12
          : step;
        const positions = polygon
          ? [
              [0, -reach],
              [0, reach],
              [-reach, 0],
              [reach, 0],
              [0, -reach - step],
              [0, reach + step],
            ]
          : [
              [0, 0],
              [0, -step],
              [0, step],
              [0, -2 * step],
              [0, 2 * step],
              [-w - 12, 0],
              [w + 12, 0],
            ];
        if (options.placement === 'fixed') positions.splice(0, positions.length, [0, 0]);
        else if (!polygon) {
          const x = anchor.x + offset[0],
            y = anchor.y + offset[1];
          for (const r of [...bodies, ...this.occupied])
            positions.push(
              [0, r.y - h / 2 - 6 - y],
              [0, r.y + r.height + h / 2 + 6 - y],
              [r.x - w / 2 - 6 - x, 0],
              [r.x + r.width + w / 2 + 6 - x, 0],
            );
          positions.sort((a, b) => Math.hypot(a[0]!, a[1]!) - Math.hypot(b[0]!, b[1]!));
        }
        for (const [dx, dy] of positions) {
          const x = Math.max(
            screen.x + w / 2,
            Math.min(screen.x + screen.width - w / 2, anchor.x + offset[0] + dx!),
          );
          const y = Math.max(
            screen.y + h / 2,
            Math.min(screen.y + screen.height - h / 2, anchor.y + offset[1] + dy!),
          );
          const box = positioned(x, y);
          if (
            contains(screen, box) &&
            ![...this.occupied, ...bodies].some((r) => overlaps(box, r, 5))
          ) {
            chosen = box;
            placement = polygon ? 'callout' : 'anchor';
            break;
          }
        }
      }
      if (!chosen) {
        hide();
        this.issues.push({ id: item.id, text: element.textContent ?? '', reason: 'no-space' });
        continue;
      }
      element.style.fontSize = `${chosenSize}px`;
      element.dataset.placement = placement;
      element.classList.toggle('ve-label-callout', placement === 'callout');
      element.style.left = `${chosen.x + chosen.width / 2}px`;
      element.style.top = `${chosen.y + chosen.height / 2}px`;
      const end = boundary(chosen, anchor, 'rect', 2);
      if (
        placement === 'callout' ||
        (Math.hypot(end.x - anchor.x, end.y - anchor.y) > 12 &&
          !contains(chosen, { ...anchor, width: 0, height: 0 }))
      ) {
        const path = route(
          anchor,
          end,
          this.occupied.map((r) => inflate(r, 3)),
        );
        if (path.length) {
          leader.setAttribute('d', pathData(path));
          leader.style.display = '';
        }
      }
      this.occupied.push(chosen);
    }
  }
  get boxes() {
    return this.occupied;
  }
  get objects() {
    return [...this.obstacles];
  }
  inspect() {
    return {
      issues: [...this.issues],
      labels: [...this.items]
        .filter((i) => !i.element.hidden)
        .map((i) => ({
          id: i.id,
          text: i.element.textContent,
          placement: i.element.dataset.placement,
        })),
    };
  }
  dispose() {
    for (const item of this.items) {
      item.element.remove();
      item.leader.remove();
    }
    this.items.clear();
    this.obstacles.clear();
    this.overlay.remove();
  }
}
