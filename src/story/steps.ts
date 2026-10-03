export interface StepOptions {
  count: number;
  render(index: number, previous: number, animate: boolean): void;
  initial?: number;
  persist?: (index: number) => void;
  interval?: number;
}
import { PlayerControls } from '../controls/player-view.js';
/* Discrete, silent demonstrations. The subject owns its states and transitions. */

function mount(
  root: HTMLElement,
  { count, render, initial = 0, persist = () => {}, interval = 2200 }: StepOptions,
) {
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
  function controls() {
    view.update({
      value: index,
      paused: !playing,
      ended: !playing && index === count - 1,
      stamp: `${index + 1} / ${count}`,
      valueText: `Шаг ${index + 1} из ${count}`,
      canBack: index > 0,
      canNext: index < count - 1,
    });
  }
  function stop() {
    playing = false;
    clearTimeout(timer);
    controls();
  }
  function go(value: number, animate = true) {
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
  play.addEventListener(
    'click',
    () => {
      if (playing) {
        stop();
        return;
      }
      if (index === count - 1) go(0, false);
      playing = true;
      controls();
      schedule();
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
    dispose() {
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
