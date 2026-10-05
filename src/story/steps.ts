export interface StepOptions {
  count: number;
  render(index: number, previous: number, animate: boolean): void;
  initial?: number;
  persist?: (index: number) => void;
  interval?: number;
}
import { PlayerControls } from '../controls/player-view.js';
import { sceneHost } from '../host/adapter.js';
/* Discrete, silent demonstrations. The subject owns its states and transitions. */

function mount(
  root: HTMLElement,
  { count, render, initial = 0, persist = () => {}, interval = 2200 }: StepOptions,
) {
  if (
    !Number.isSafeInteger(count) ||
    count < 1 ||
    !Number.isFinite(interval) ||
    interval <= 0 ||
    !Number.isSafeInteger(initial)
  )
    throw new Error('Step playback needs a positive count/interval and an integer initial step');
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  const view = PlayerControls.mount(root.querySelector<HTMLElement>('[data-player]')!, {
    chapters: true,
    max: count - 1,
    step: 1,
    label: 'Шаг объяснения',
  });
  const { play, back, next, seek } = view;
  let index = Math.max(0, Math.min(count - 1, initial)),
    playing = false,
    timer: ReturnType<typeof setTimeout> | undefined;
  let permission: AbortController | undefined;
  function controls() {
    view.update({
      value: index,
      paused: !playing && !permission,
      ended: !playing && index === count - 1,
      stamp: `${index + 1} / ${count}`,
      valueText: `Шаг ${index + 1} из ${count}`,
      canBack: index > 0,
      canNext: index < count - 1,
    });
  }
  function stop() {
    permission?.abort();
    permission = undefined;
    playing = false;
    clearTimeout(timer);
    controls();
  }
  function go(value: number, animate = true) {
    if (abort.signal.aborted) throw new Error('Step playback has been disposed');
    if (!Number.isSafeInteger(value)) throw new Error('Step index must be an integer');
    const previous = index;
    index = Math.max(0, Math.min(count - 1, value));
    render(index, previous, animate);
    controls();
    persist(index);
  }
  function schedule() {
    timer = setTimeout(() => {
      if (!playing) return;
      go(index + 1);
      if (index === count - 1) stop();
      else schedule();
    }, interval);
  }
  async function start() {
    if (abort.signal.aborted || playing || permission) return;
    const policy = sceneHost()?.beforePlay;
    if (policy) {
      const request = (permission = new AbortController());
      controls();
      try {
        await policy({ muted: true, hasAudio: false, signal: request.signal });
      } catch (error) {
        if (!request.signal.aborted) throw error;
      } finally {
        if (permission === request) permission = undefined;
        if (!abort.signal.aborted) controls();
      }
      if (abort.signal.aborted || request.signal.aborted) return;
    }
    if (index === count - 1) go(0, false);
    playing = true;
    controls();
    schedule();
  }
  play.addEventListener(
    'click',
    () => {
      if (playing || permission) stop();
      else
        void start().catch((error) =>
          root.dispatchEvent(
            new CustomEvent('scene-playback-error', { bubbles: true, detail: error }),
          ),
        );
    },
    listen,
  );
  back!.addEventListener(
    'click',
    () => {
      stop();
      go(index - 1);
    },
    listen,
  );
  next!.addEventListener(
    'click',
    () => {
      stop();
      go(index + 1);
    },
    listen,
  );
  seek.addEventListener(
    'input',
    () => {
      const value = Number(seek.value);
      stop();
      go(value, false);
    },
    listen,
  );
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) stop();
    },
    listen,
  );
  controls();
  render(index, index, false);
  return {
    play: start,
    pause: stop,
    get playing() {
      return playing;
    },
    dispose() {
      if (abort.signal.aborted) return;
      stop();
      abort.abort();
      view.dispose();
    },
    get index() {
      return index;
    },
    go(value: number) {
      stop();
      go(value, false);
    },
  };
}
export const StepPlayer = { mount };
