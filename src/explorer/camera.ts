import type { Bounds, CameraPose, ExplorerTarget, ExplorerScene, ExplorerPoint } from './types.js';
export class SvgCamera {
  viewport: HTMLElement | SVGSVGElement;
  svg: SVGSVGElement;
  hits?: HTMLElement;
  world: SVGGElement;
  layers: SVGGElement[];
  matrix: CameraPose;
  bounds: ExplorerTarget[];
  frame: number;
  token: number;
  travel: { hit: ExplorerTarget; amount: number; direction?: 'in' | 'out' } | null;
  reduced: MediaQueryList;
  reducedOverride?: boolean;
  viewportSize = { w: 0, h: 0 };
  body?: string;
  parentLayer?: SVGGElement;
  childLayer?: SVGGElement;
  constructor(viewport: HTMLElement | SVGSVGElement, svg: SVGSVGElement, hits?: HTMLElement) {
    this.viewport = viewport;
    this.svg = svg;
    this.hits = hits;
    this.world = svg.querySelector<SVGGElement>('[data-camera-world]')!;
    this.layers = [...svg.querySelectorAll<SVGGElement>('[data-camera-transform]')];
    this.matrix = { s: 1, x: 0, y: 0 };
    this.bounds = [];
    this.frame = 0;
    this.token = 0;
    this.travel = null;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
  }
  get size() {
    return { w: this.viewport.clientWidth, h: this.viewport.clientHeight };
  }
  fit(box: Bounds, padding?: number) {
    const { w, h } = this.size,
      s = Math.max(
        0.05,
        Math.min(
          (w - (padding === undefined ? 32 : 2 * padding)) / box.w,
          (h - (padding === undefined ? 60 : 2 * padding)) / box.h,
        ),
      );
    return {
      s,
      x: w / 2 - s * (box.x + box.w / 2),
      y: (h + (padding === undefined ? 28 : 0)) / 2 - s * (box.y + box.h / 2),
    };
  }
  syncViewport() {
    this.viewportSize = this.size;
    const { w, h } = this.viewportSize;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  }
  install(body: string, bounds: ExplorerTarget[] = []) {
    if (this.body !== body) {
      this.world.innerHTML = body;
      this.body = body;
    }
    this.bounds = bounds;
  }
  set(matrix: CameraPose) {
    this.matrix = matrix;
    for (const layer of this.layers)
      layer.setAttribute('transform', `translate(${matrix.x} ${matrix.y}) scale(${matrix.s})`);
    this.bounds.forEach((hit, i) => {
      const button = this.hits?.children[i] as HTMLElement | undefined;
      if (!button) return;
      const { x, y, w, h } = hit.box;
      Object.assign(button.style, {
        left: `${x * matrix.s + matrix.x}px`,
        top: `${y * matrix.s + matrix.y}px`,
        width: `${w * matrix.s}px`,
        height: `${h * matrix.s}px`,
      });
    });
  }
  show(scene: ExplorerScene, matrix = this.fit(scene.box)) {
    this.cancel();
    this.travel = null;
    this.parentLayer = undefined;
    this.childLayer = undefined;
    this.syncViewport();
    this.install(scene.body, scene.hits);
    this.set(matrix);
  }
  cancel() {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.token++;
  }
  animate(
    target: CameraPose,
    done: () => void,
    update: (amount: number) => void = () => {},
    duration = 410,
  ) {
    this.cancel();
    this.syncViewport();
    const token = this.token,
      start = performance.now(),
      from = { ...this.matrix };
    const tick = (now: number) => {
      if (token !== this.token) return;
      const p =
          (this.reducedOverride ?? this.reduced.matches)
            ? 1
            : Math.min(1, (now - start) / duration),
        t = p * p * (3 - 2 * p);
      this.set(this.interpolate(from, target, t));
      update(t);
      if (p < 1) this.frame = requestAnimationFrame(tick);
      else {
        this.frame = 0;
        done();
      }
    };
    this.frame = requestAnimationFrame(tick);
  }
  /** The same pose interpolation is available to a narrated, seekable frame. */
  interpolate(from: CameraPose, target: CameraPose, amount: number): CameraPose {
    const t = Math.max(0, Math.min(1, amount));
    const center = { x: this.size.w / 2, y: (this.size.h + 28) / 2 },
      reference = target.s > from.s ? target : from;
    const anchor = {
      x: (center.x - reference.x) / reference.s,
      y: (center.y - reference.y) / reference.s,
    };
    const initial = { x: anchor.x * from.s + from.x, y: anchor.y * from.s + from.y };
    const final = { x: anchor.x * target.s + target.x, y: anchor.y * target.s + target.y };
    const s = Math.exp(Math.log(from.s) * (1 - t) + Math.log(target.s) * t);
    return {
      s,
      x: initial.x + (final.x - initial.x) * t - anchor.x * s,
      y: initial.y + (final.y - initial.y) * t - anchor.y * s,
    };
  }
  embed(child: ExplorerScene, hit: ExplorerTarget) {
    const a = child.box,
      b = hit.box,
      s = Math.min(b.w / a.w, b.h / a.h);
    const x = b.x + b.w / 2 - s * (a.x + a.w / 2),
      y = b.y + b.h / 2 - s * (a.y + a.h / 2);
    return { s, x, y, box: { x: s * a.x + x, y: s * a.y + y, w: a.w * s, h: a.h * s } };
  }
  moveInto(parent: ExplorerScene, child: ExplorerScene, hit: ExplorerTarget, done: () => void) {
    const embedding = this.embed(child, hit),
      from = { ...this.matrix };
    this.compose(parent, child, hit, embedding);
    this.set(from);
    this.travel!.direction = 'in';
    this.reveal(0);
    this.animate(this.fit(embedding.box), done, (t) => this.reveal(t));
  }
  moveOut(parent: ExplorerScene, child: ExplorerScene, hit: ExplorerTarget, done: () => void) {
    if (this.travel?.direction === 'in' && this.travel.hit.key === hit.key) {
      const from = this.travel!.amount;
      this.travel!.direction = 'out';
      this.animate(this.fit(parent.box), done, (t) => this.reveal(from * (1 - t)), 330);
      return;
    }
    const embedding = this.embed(child, hit),
      m = this.matrix;
    const start = {
      s: m.s / embedding.s,
      x: m.x - (m.s / embedding.s) * embedding.x,
      y: m.y - (m.s / embedding.s) * embedding.y,
    };
    this.compose(parent, child, hit, embedding);
    this.set(start);
    this.travel!.direction = 'out';
    this.reveal(1);
    this.animate(this.fit(parent.box), done, (t) => this.reveal(1 - t));
  }
  compose(parent: ExplorerScene, child: ExplorerScene, hit: ExplorerTarget, e: CameraPose) {
    this.cancel();
    this.install(
      `<g data-parent-scene>${parent.body}</g><g data-child-scene transform="translate(${e.x} ${e.y}) scale(${e.s})">${child.body}</g>`,
    );
    this.travel = { hit, amount: 0 };
    this.parentLayer = this.world.querySelector<SVGGElement>('[data-parent-scene]')!;
    this.childLayer = this.world.querySelector<SVGGElement>('[data-child-scene]')!;
  }
  reveal(amount: number) {
    this.travel!.amount = amount;
    this.parentLayer!.setAttribute('opacity', String(1 - amount));
    this.childLayer!.setAttribute('opacity', String(amount));
  }
  zoom(factor: number, point: ExplorerPoint, box: Bounds) {
    const old = this.matrix,
      base = this.fit(box).s,
      s = Math.min(base * 9, Math.max(base * 0.65, old.s * factor)),
      r = s / old.s;
    this.set({ s, x: point.x - (point.x - old.x) * r, y: point.y - (point.y - old.y) * r });
  }
  dispose() {
    this.cancel();
    this.travel = null;
    this.parentLayer = undefined;
    this.childLayer = undefined;
    this.world.replaceChildren();
    this.hits?.replaceChildren();
    this.bounds = [];
    this.body = undefined;
  }
}
