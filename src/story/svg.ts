import { PlayerControls } from '../controls/player-view.js';
import { mountScene } from '../scene-handle.js';
/* SVG's native animation time remains the sole clock. */

function mount(root: HTMLElement, { duration }: { duration: number }) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('SVG duration must be positive');
  const object = root.querySelector<HTMLObjectElement | HTMLIFrameElement>(
    'object,iframe[data-scene-svg]',
  );
  const controlsHost = root.querySelector<HTMLElement>('[data-player]');
  if (!object || !controlsHost) throw new Error('SVG player needs an object and player controls');
  const controls = PlayerControls.mount(controlsHost, {
    max: duration,
    label: 'Фаза колебаний в секундах',
  });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  let svg: SVGSVGElement | null = null,
    frame = 0;
  let resolveReady: () => void, rejectReady: (error: Error) => void;
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const current = () => {
    if (!svg) throw new Error('SVG scene is not ready');
    return svg;
  };
  function pause() {
    svg?.pauseAnimations();
    update();
  }
  function play() {
    current().unpauseAnimations();
    update();
  }
  function seek(time: number) {
    if (!Number.isFinite(time)) throw new Error('SVG time must be finite');
    current().pauseAnimations();
    current().setCurrentTime(Math.max(0, Math.min(duration, time)));
    update();
  }
  const scene = mountScene(root, {
    duration,
    get currentTime() {
      const elapsed = svg?.getCurrentTime() ?? 0;
      return svg?.animationsPaused() && elapsed === duration ? duration : elapsed % duration;
    },
    get playing() {
      return Boolean(svg && !svg.animationsPaused());
    },
    play,
    pause,
    seek,
    svg: current,
    setReduced(value) {
      if (value) pause();
    },
    snapshot: (): { time: number } => ({ time: scene.currentTime }),
    dispose() {
      rejectReady(new Error('SVG player was disposed before it became ready'));
      abort.abort();
      cancelAnimationFrame(frame);
      svg?.pauseAnimations();
      controls.dispose();
    },
  });
  controls.play.disabled = true;
  controls.seek.disabled = true;
  function update() {
    cancelAnimationFrame(frame);
    if (!svg) return;
    const value = scene.currentTime;
    const stamp = `${value.toFixed(1)} / ${duration} с`;
    controls.update({ value, paused: svg.animationsPaused(), stamp, valueText: stamp });
    if (!svg.animationsPaused()) frame = requestAnimationFrame(update);
  }
  const ready = () => {
    svg = object.contentDocument?.querySelector('svg') ?? null;
    if (!svg?.getCurrentTime) {
      svg = null;
      rejectReady(new Error('Loaded document has no animated SVG'));
      return;
    }
    if (reduced.matches || document.hidden) svg.pauseAnimations();
    controls.play.disabled = false;
    controls.seek.disabled = false;
    update();
    resolveReady();
  };
  object.addEventListener('load', ready, listen);
  object.addEventListener(
    'error',
    () => rejectReady(new Error('SVG document failed to load')),
    listen,
  );
  if (object.contentDocument?.querySelector('svg')?.getCurrentTime) ready();
  controls.play.addEventListener(
    'click',
    () => {
      svg?.animationsPaused() ? play() : pause();
    },
    listen,
  );
  controls.seek.addEventListener(
    'input',
    () => {
      seek(Number(controls.seek.value));
    },
    listen,
  );
  reduced.addEventListener(
    'change',
    () => {
      if (reduced.matches) svg?.pauseAnimations();
      update();
    },
    listen,
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) svg?.pauseAnimations();
      update();
    },
    listen,
  );
  return { scene, ready: readyPromise, dispose: scene.dispose };
}
export const SmilPlayer = { mount };
