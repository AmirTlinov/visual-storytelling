import { PlayerControls } from '../controls/player-view.js';
/* SVG's native animation time remains the sole clock. */

function mount(root: HTMLElement, { duration }: { duration: number }) {
  const object = root.querySelector<HTMLObjectElement | HTMLIFrameElement>(
    'object,iframe[data-scene-svg]',
  )!;
  const controls = PlayerControls.mount(root.querySelector<HTMLElement>('[data-player]')!, {
    max: duration,
    label: 'Фаза колебаний в секундах',
  });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  let svg: SVGSVGElement | null = null,
    frame = 0;
  controls.play.disabled = true;
  controls.seek.disabled = true;
  function update() {
    cancelAnimationFrame(frame);
    if (!svg) return;
    const elapsed = svg.getCurrentTime();
    const value = svg.animationsPaused() && elapsed === duration ? duration : elapsed % duration;
    const stamp = `${value.toFixed(1)} / ${duration} с`;
    controls.update({ value, paused: svg.animationsPaused(), stamp, valueText: stamp });
    if (!svg.animationsPaused()) frame = requestAnimationFrame(update);
  }
  const ready = () => {
    svg = object.contentDocument?.querySelector('svg') ?? null;
    if (!svg?.getCurrentTime) {
      svg = null;
      return;
    }
    if (reduced.matches || document.hidden) svg.pauseAnimations();
    controls.play.disabled = false;
    controls.seek.disabled = false;
    update();
  };
  object.addEventListener('load', ready, listen);
  if (object.contentDocument?.querySelector('svg')?.getCurrentTime) ready();
  controls.play.addEventListener(
    'click',
    () => {
      svg?.animationsPaused() ? svg.unpauseAnimations() : svg?.pauseAnimations();
      update();
    },
    listen,
  );
  controls.seek.addEventListener(
    'input',
    () => {
      svg?.pauseAnimations();
      svg?.setCurrentTime(Number(controls.seek.value));
      update();
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
  return {
    dispose() {
      abort.abort();
      cancelAnimationFrame(frame);
      svg?.pauseAnimations();
    },
  };
}
export const SmilPlayer = { mount };
