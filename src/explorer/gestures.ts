import type { SvgCamera } from './camera.js';
import type { SvgHighlight } from './highlight.js';
import type { CameraPose, ExplorerScene, ExplorerPoint } from './types.js';
export class SvgGestures {
  private abort = new AbortController();
  viewport: HTMLElement | SVGSVGElement;
  camera: SvgCamera;
  highlight?: SvgHighlight;
  scene: () => Pick<ExplorerScene, 'box' | 'hits'>;
  open: (key: string) => void;
  changed: () => void;
  settled: () => void;
  wheelTimer?: ReturnType<typeof setTimeout>;
  pointers: Map<number, ExplorerPoint>;
  gesture: { matrix: CameraPose; points: ExplorerPoint[]; moved: boolean; tapKey?: string } | null;
  suppressClickUntil: number;
  constructor(
    viewport: HTMLElement | SVGSVGElement,
    camera: SvgCamera,
    highlight: SvgHighlight | undefined,
    {
      scene,
      open = () => {},
      fit,
      changed,
      settled = () => {},
    }: {
      scene: () => Pick<ExplorerScene, 'box' | 'hits'>;
      open?: (key: string) => void;
      fit: () => void;
      changed: () => void;
      settled?: () => void;
    },
  ) {
    this.viewport = viewport;
    this.camera = camera;
    this.highlight = highlight;
    this.scene = scene;
    this.open = open;
    this.changed = changed;
    this.settled = settled;
    this.pointers = new Map();
    this.gesture = null;
    this.suppressClickUntil = 0;
    const events: GlobalEventHandlers = viewport;
    events.addEventListener(
      'dblclick',
      (event) => {
        if (camera.travel || performance.now() < this.suppressClickUntil) {
          event.preventDefault();
          return;
        }
        if (!(event.target as Element).closest('button')) {
          event.preventDefault();
          fit();
        }
      },
      { signal: this.abort.signal },
    );
    events.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        if (camera.travel) return;
        camera.cancel();
        camera.zoom(
          Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.004),
          this.local(event),
          scene().box,
        );
        changed();
        clearTimeout(this.wheelTimer);
        this.wheelTimer = setTimeout(settled, 160);
      },
      { passive: false, signal: this.abort.signal },
    );
    events.addEventListener('pointerdown', (event) => this.start(event), {
      signal: this.abort.signal,
    });
    events.addEventListener('pointermove', (event) => this.move(event), {
      signal: this.abort.signal,
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const)
      events.addEventListener(type, (event) => this.end(event), { signal: this.abort.signal });
    events.addEventListener(
      'pointerleave',
      (event) => {
        if (!viewport.hasPointerCapture(event.pointerId)) this.end(event);
      },
      { signal: this.abort.signal },
    );
    events.addEventListener(
      'click',
      (event) => {
        if (event.detail > 0 && performance.now() < this.suppressClickUntil) {
          event.preventDefault();
          event.stopPropagation();
        }
      },
      { capture: true, signal: this.abort.signal },
    );
  }
  local(event: MouseEvent) {
    const box = this.viewport.getBoundingClientRect();
    return {
      x: (event.clientX - box.left) * (box.width ? this.viewport.clientWidth / box.width : 1),
      y: (event.clientY - box.top) * (box.height ? this.viewport.clientHeight / box.height : 1),
    };
  }
  nearby(point: ExplorerPoint, target: Element) {
    const direct = target.closest<HTMLElement>('[data-hit-key]');
    if (direct) return direct.dataset.hitKey;
    const { s, x, y } = this.camera.matrix;
    const candidates = this.scene()
      .hits.map((hit) => {
        const box = hit.box,
          left = box.x * s + x,
          top = box.y * s + y,
          w = box.w * s,
          h = box.h * s;
        return {
          key: hit.key,
          distance: Math.hypot(
            Math.max(left - point.x, 0, point.x - left - w),
            Math.max(top - point.y, 0, point.y - top - h),
          ),
          center: Math.hypot(point.x - left - w / 2, point.y - top - h / 2),
        };
      })
      .filter((hit) => hit.distance <= 18)
      .sort((a, b) => a.distance - b.distance || a.center - b.center);
    return candidates[0]?.key;
  }
  begin() {
    const points = [...this.pointers.values()];
    this.gesture = {
      matrix: { ...this.camera.matrix },
      points: points.map((p) => ({ ...p })),
      moved: points.length > 1,
    };
  }
  start(event: PointerEvent) {
    if ((event.target as Element).closest('[data-camera-reset]')) {
      this.suppressClickUntil = 0;
      return;
    }
    if (event.button > 1 || this.camera.travel) return;
    if (event.button === 1) event.preventDefault();
    if (this.pointers.size === 0) this.suppressClickUntil = 0;
    this.camera.cancel();
    this.pointers.set(event.pointerId, this.local(event));
    this.begin();
    if (event.pointerType === 'touch' && this.pointers.size === 1) {
      this.gesture!.tapKey = this.nearby(this.local(event), event.target as Element);
      this.highlight?.show(this.gesture!.tapKey);
    } else if (this.pointers.size > 1) this.highlight?.clear();
    if (this.pointers.size > 1)
      for (const id of this.pointers.keys()) this.viewport.setPointerCapture(id);
  }
  move(event: PointerEvent) {
    if (!this.pointers.has(event.pointerId) || !this.gesture) return;
    this.pointers.set(event.pointerId, this.local(event));
    const points = [...this.pointers.values()],
      gesture = this.gesture,
      start = gesture.points;
    if (points.length === 1 && start.length === 1) {
      const dx = points[0]!.x - start[0]!.x,
        dy = points[0]!.y - start[0]!.y;
      if (Math.hypot(dx, dy) > 5 || gesture.moved) {
        this.highlight?.clear();
        gesture.moved = true;
        this.viewport.setPointerCapture(event.pointerId);
        this.camera.set({
          s: gesture.matrix.s,
          x: gesture.matrix.x + dx,
          y: gesture.matrix.y + dy,
        });
      }
    } else if (points.length >= 2 && start.length >= 2) {
      this.highlight?.clear();
      gesture.moved = true;
      const distance = (p: ExplorerPoint[]) => Math.hypot(p[1]!.x - p[0]!.x, p[1]!.y - p[0]!.y),
        mid = (p: ExplorerPoint[]) => ({ x: (p[0]!.x + p[1]!.x) / 2, y: (p[0]!.y + p[1]!.y) / 2 });
      const a = mid(start),
        b = mid(points),
        base = this.camera.fit(this.scene().box).s;
      const s = Math.max(
          base * 0.65,
          Math.min(base * 9, (gesture.matrix.s * distance(points)) / Math.max(1, distance(start))),
        ),
        ratio = s / gesture.matrix.s;
      this.camera.set({
        s,
        x: b.x - (a.x - gesture.matrix.x) * ratio,
        y: b.y - (a.y - gesture.matrix.y) * ratio,
      });
    }
    if (gesture.moved) this.changed();
  }
  end(event: PointerEvent) {
    if (!this.pointers.has(event.pointerId)) return;
    const tap =
      event.type === 'pointerup' &&
      event.pointerType === 'touch' &&
      this.pointers.size === 1 &&
      !this.gesture?.moved
        ? this.gesture?.tapKey
        : null;
    if (this.gesture?.moved) {
      this.suppressClickUntil = performance.now() + 120;
      this.settled();
    }
    if (event.pointerType === 'touch') this.highlight?.clear();
    this.pointers.delete(event.pointerId);
    if (this.viewport.hasPointerCapture(event.pointerId))
      this.viewport.releasePointerCapture(event.pointerId);
    if (this.pointers.size) {
      this.begin();
      this.gesture!.moved = true;
    } else this.gesture = null;
    if (tap) {
      this.suppressClickUntil = performance.now() + 350;
      this.open(tap);
    }
  }
  cancel() {
    clearTimeout(this.wheelTimer);
    if (this.pointers.size) this.suppressClickUntil = performance.now() + 350;
    const captured = [...this.pointers.keys()];
    this.pointers.clear();
    this.gesture = null;
    for (const id of captured)
      if (this.viewport.hasPointerCapture(id)) this.viewport.releasePointerCapture(id);
  }
  dispose() {
    clearTimeout(this.wheelTimer);
    this.abort.abort();
    this.cancel();
    this.highlight?.clear();
  }
}
