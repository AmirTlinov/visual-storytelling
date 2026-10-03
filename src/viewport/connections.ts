import type { Object3D, PerspectiveCamera } from './engine.js';
import { projectBox, isVisible } from './projection.js';
import { connector, pathData, type Rect, type Point2 } from '../layout/geometry.js';
const svg = <K extends keyof SVGElementTagNameMap>(tag: K) =>
  document.createElementNS('http://www.w3.org/2000/svg', tag);
export interface ConnectionOptions {
  id?: string;
  tone?: string;
  gap?: number;
  fromShape?: 'rect' | 'ellipse';
  toShape?: 'rect' | 'ellipse';
  avoid?: readonly Object3D[];
  /** Intentional carriers on this connection are not routing obstacles. */
  ignore?: readonly Object3D[];
  visible?: () => boolean;
}
type Connection = {
  from: Object3D;
  to: Object3D;
  options: ConnectionOptions;
  path: SVGPathElement;
  head: SVGPathElement;
  progress: number;
  points: Point2[];
  route?: { key: string; points: Point2[] };
};
export interface ConnectionIssue {
  id: string;
  reason: 'no-route';
}
/** Screen-space routes use projected objects and lettering as occupied space. */
export class ProjectedConnections {
  private overlay = svg('svg');
  private items = new Set<Connection>();
  private serial = 0;
  private issues: ConnectionIssue[] = [];
  constructor(
    private stage: HTMLElement,
    private camera: PerspectiveCamera,
    private labels: () => readonly Rect[],
    private bodies: () => readonly Object3D[],
    private invalidate: () => void,
  ) {
    this.overlay.classList.add('ve-connections');
    this.overlay.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:1';
    this.overlay.setAttribute('aria-hidden', 'true');
    stage.append(this.overlay);
  }
  add(from: Object3D, to: Object3D, options: ConnectionOptions = {}) {
    const path = svg('path'),
      head = svg('path');
    path.dataset.connection = options.id ?? `connection-${++this.serial}`;
    for (const p of [path, head]) {
      p.setAttribute('stroke', `var(--ve-${options.tone ?? 'ink'})`);
      p.setAttribute('stroke-width', '1.5');
      p.setAttribute('stroke-linecap', 'round');
      p.setAttribute('stroke-linejoin', 'round');
      p.setAttribute('fill', 'none');
      this.overlay.append(p);
    }
    const item: Connection = { from, to, options, path, head, progress: 1, points: [] };
    this.items.add(item);
    this.invalidate();
    return {
      reveal: (p: number) => {
        item.progress = Math.max(0, Math.min(1, p));
        this.invalidate();
      },
      inspect: () => ({
        points: item.points.map((p) => ({ ...p })),
        visible: item.path.style.display !== 'none',
      }),
      dispose: () => {
        this.items.delete(item);
        path.remove();
        head.remove();
      },
    };
  }
  render() {
    const w = this.stage.clientWidth,
      h = this.stage.clientHeight;
    this.overlay.setAttribute('viewBox', `0 0 ${w} ${h}`);
    this.issues = [];
    const project = (o: Object3D) => projectBox(o, this.camera, w, h);
    for (const item of this.items) {
      const { from, to, options, path, head, progress } = item;
      path.style.display = head.style.display = 'none';
      item.points = [];
      if (
        progress <= 0 ||
        !isVisible(from) ||
        !isVisible(to) ||
        (options.visible && !options.visible())
      )
        continue;
      const a = project(from),
        b = project(to);
      const obstacles = [
        ...[...new Set([...this.bodies(), ...(options.avoid ?? [])])]
          .filter((o) => o !== from && o !== to && !options.ignore?.includes(o) && isVisible(o))
          .map(project),
        ...this.labels().filter(
          (r) =>
            !(
              (r.x >= a.x &&
                r.x + r.width <= a.x + a.width &&
                r.y >= a.y &&
                r.y + r.height <= a.y + a.height) ||
              (r.x >= b.x &&
                r.x + r.width <= b.x + b.width &&
                r.y >= b.y &&
                r.y + r.height <= b.y + b.height)
            ),
        ),
      ];
      const key = [a, b, ...obstacles]
        .flatMap((r) => [r.x, r.y, r.width, r.height])
        .map((n) => n.toFixed(3))
        .join(',');
      if (item.route?.key !== key)
        item.route = { key, points: connector(a, b, obstacles, options) };
      const points = item.route.points;
      item.points = points;
      if (points.length < 2) {
        this.issues.push({ id: path.dataset.connection!, reason: 'no-route' });
        continue;
      }
      path.setAttribute('d', pathData(points));
      path.style.display = '';
      const length = points
        .slice(1)
        .reduce(
          (sum, point, i) => sum + Math.hypot(point.x - points[i]!.x, point.y - points[i]!.y),
          0,
        );
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = String(length * (1 - progress));
      if (progress < 0.999) continue;
      const end = points.at(-1)!,
        before = points.at(-2)!,
        angle = Math.atan2(end.y - before.y, end.x - before.x),
        size = 7;
      const tip = (offset: number) => ({
        x: end.x - size * Math.cos(angle + offset),
        y: end.y - size * Math.sin(angle + offset),
      });
      head.setAttribute('d', pathData([tip(0.5), end, tip(-0.5)]));
      head.style.display = '';
    }
  }
  inspect() {
    return { issues: [...this.issues] };
  }
  dispose() {
    this.items.clear();
    this.overlay.remove();
  }
}
