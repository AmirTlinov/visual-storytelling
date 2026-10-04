import { SvgCamera } from '../explorer/camera.js';
import { SvgGestures } from '../explorer/gestures.js';
import type { Bounds } from '../explorer/types.js';
import { SvgLayout } from '../layout/svg.js';

export type SvgShotTarget = SVGGraphicsElement | { element: SVGGraphicsElement } | Bounds;
export interface SvgShot {
  target: SvgShotTarget | readonly SvgShotTarget[];
  padding?: number;
}
export interface SvgShotTransition extends SvgShot {
  from?: SvgShot;
  progress?: number;
  reduced?: boolean;
}

/** A narrated adapter over the explorer's camera and gestures, without another clock. */
function mount(svg: SVGSVGElement, { onInteract = () => {} } = {}) {
  const world = svg.querySelector<SVGGElement>('[data-camera-world]');
  if (!world)
    throw new Error(
      'ViewportSVG needs a surface() or a <g data-camera-world data-camera-transform>',
    );
  const viewport = svg;
  const camera = new SvgCamera(viewport, svg);
  const abort = new AbortController();
  const original = {
    viewBox: svg.getAttribute('viewBox'),
    touchAction: svg.style.touchAction,
    overflow: svg.style.overflow,
    tabIndex: svg.getAttribute('tabindex'),
  };
  svg.tabIndex = 0;
  svg.style.touchAction = 'none';
  svg.style.overflow = 'hidden';
  let following = true,
    last: SvgShotTransition | undefined;
  const bounds = (target: SvgShot['target']): Bounds => {
    const targets = Array.isArray(target) ? target : [target];
    if (!targets.length) throw new Error('A camera shot needs at least one target');
    const boxes = targets.map((item) => {
      if ('w' in item) return item as Bounds;
      const element = 'element' in item ? item.element : item;
      const box = SvgLayout.box(element as SVGGraphicsElement, world);
      return { x: box.x, y: box.y, w: box.width, h: box.height };
    });
    const x = Math.min(...boxes.map((b) => b.x)),
      y = Math.min(...boxes.map((b) => b.y));
    return {
      x,
      y,
      w: Math.max(1, Math.max(...boxes.map((b) => b.x + b.w)) - x),
      h: Math.max(1, Math.max(...boxes.map((b) => b.y + b.h)) - y),
    };
  };
  function shot(options: SvgShotTransition) {
    last = options;
    if (!following) return;
    camera.syncViewport();
    const target = camera.fit(bounds(options.target), options.padding ?? 24);
    const p = Math.max(0, Math.min(1, options.progress ?? 1));
    const amount =
      (options.reduced ?? camera.reduced.matches) ? Number(p > 0) : p * p * (3 - 2 * p);
    const authored = options.from
      ? camera.interpolate(
          camera.fit(bounds(options.from.target), options.from.padding ?? 24),
          target,
          amount,
        )
      : target;
    camera.set(authored);
  }
  function reset() {
    following = true;
    if (last) shot(last);
  }
  function manual() {
    following = false;
    onInteract();
  }
  const gestures = new SvgGestures(viewport, camera, undefined, {
    scene: () => ({ box: bounds(world), hits: [] }),
    fit: reset,
    changed: manual,
  });
  svg.addEventListener(
    'keydown',
    (event) => {
      if (
        ![
          'ArrowLeft',
          'ArrowRight',
          'ArrowUp',
          'ArrowDown',
          '+',
          '=',
          '-',
          '_',
          'Home',
          '0',
        ].includes(event.key)
      )
        return;
      event.preventDefault();
      if (event.key === 'Home' || event.key === '0') return reset();
      manual();
      if (['+', '=', '-', '_'].includes(event.key))
        camera.zoom(
          ['+', '='].includes(event.key) ? 1.12 : 1 / 1.12,
          { x: camera.size.w / 2, y: camera.size.h / 2 },
          bounds(world),
        );
      else
        camera.set({
          ...camera.matrix,
          x:
            camera.matrix.x +
            (event.key === 'ArrowLeft' ? 24 : event.key === 'ArrowRight' ? -24 : 0),
          y: camera.matrix.y + (event.key === 'ArrowUp' ? 24 : event.key === 'ArrowDown' ? -24 : 0),
        });
    },
    { signal: abort.signal },
  );
  camera.syncViewport();
  const observer = new ResizeObserver(() => {
    if (!camera.size.w || !camera.size.h) return;
    const old = camera.viewportSize,
      pose = camera.matrix;
    camera.syncViewport();
    if (following) {
      if (last) shot(last);
    } else if (old.w && old.h) {
      const next = camera.size,
        ratio = Math.min(next.w / old.w, next.h / old.h);
      camera.set({
        s: pose.s * ratio,
        x: next.w / 2 - (old.w / 2 - pose.x) * ratio,
        y: next.h / 2 - (old.h / 2 - pose.y) * ratio,
      });
    }
  });
  observer.observe(viewport);
  return {
    shot,
    reset,
    get following() {
      return following;
    },
    get pose() {
      return { ...camera.matrix };
    },
    dispose() {
      observer.disconnect();
      abort.abort();
      gestures.dispose();
      camera.cancel();
      for (const layer of camera.layers) layer.removeAttribute('transform');
      if (original.viewBox) svg.setAttribute('viewBox', original.viewBox);
      else svg.removeAttribute('viewBox');
      if (original.tabIndex === null) svg.removeAttribute('tabindex');
      else svg.setAttribute('tabindex', original.tabIndex);
      svg.style.touchAction = original.touchAction;
      svg.style.overflow = original.overflow;
    },
  };
}
export const ViewportSVG = { mount };
