import { PlayerControls } from '../controls/player-view.js';
import { mountScene } from '../scene-handle.js';
import { sceneHost } from '../host/adapter.js';
import { sceneFrame } from '../scene-frame.js';
/* SVG's native animation time remains the sole clock. */

function mount(root: HTMLElement, { duration }: { duration: number }) {
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('SVG duration must be positive');
  const object = root.querySelector<HTMLObjectElement | HTMLIFrameElement>(
    'object,iframe[data-scene-svg]',
  );
  const controlsHost = root.querySelector<HTMLElement>('[data-player]');
  if (!object || !controlsHost) throw new Error('SVG player needs an object and player controls');
  const content = document.createElement('div');
  content.className = 've-smil-content';
  content.append(...root.childNodes);
  const presentation = sceneFrame(content, { width: 1280, height: 720, scope: 'scene' });
  root.append(presentation.element);
  presentation.resize();
  const controls = PlayerControls.mount(controlsHost, {
    max: duration,
    label: 'Фаза колебаний в секундах',
  });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  let svg: SVGSVGElement | null = null,
    frame = 0;
  let permission: AbortController | undefined;
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
    permission?.abort();
    permission = undefined;
    svg?.pauseAnimations();
    update();
  }
  async function play() {
    if (permission || abort.signal.aborted) return;
    const policy = sceneHost()?.beforePlay;
    if (policy) {
      const request = (permission = new AbortController());
      update();
      try {
        await policy({ muted: true, hasAudio: false, signal: request.signal });
      } catch (error) {
        if (!request.signal.aborted) throw error;
      } finally {
        if (permission === request) permission = undefined;
        if (!abort.signal.aborted) update();
      }
      if (abort.signal.aborted || request.signal.aborted) return;
    }
    current().unpauseAnimations();
    update();
  }
  function seek(time: number) {
    if (!Number.isFinite(time)) throw new Error('SVG time must be finite');
    pause();
    current().setCurrentTime(Math.max(0, Math.min(duration, time)));
    update();
  }
  const scene = mountScene(root, {
    ready: () => readyPromise,
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
      permission?.abort();
      permission = undefined;
      cancelAnimationFrame(frame);
      svg?.pauseAnimations();
      controls.dispose();
      presentation.dispose();
      presentation.element.remove();
    },
  });
  controls.play.disabled = true;
  controls.seek.disabled = true;
  function update() {
    cancelAnimationFrame(frame);
    if (!svg) return;
    const value = scene.currentTime;
    const stamp = `${value.toFixed(1)} / ${duration} с`;
    controls.update({
      value,
      paused: svg.animationsPaused() && !permission,
      stamp,
      valueText: stamp,
    });
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
      if (!svg?.animationsPaused() || permission) pause();
      else
        void play().catch((error) => {
          const status =
            controlsHost.querySelector('[role=alert]') ??
            controlsHost.appendChild(document.createElement('p'));
          status.setAttribute('role', 'alert');
          status.textContent = error.message;
        });
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
      if (reduced.matches) pause();
      update();
    },
    listen,
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) pause();
      update();
    },
    listen,
  );
  return { scene, ready: readyPromise, dispose: scene.dispose };
}
export const SmilPlayer = { mount };
