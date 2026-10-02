import { PlayerControls } from '../controls/player-view.js';
export interface SimulationState {
  value: number;
  done: boolean;
  stamp: string;
  canStep?: boolean;
}
export interface SimulationOptions {
  read(): SimulationState;
  prepare(): void;
  /** Elapsed milliseconds since play; return true only when subject drawing changed. */
  advance(elapsed: number): boolean;
  step(): void;
  render(): void;
  commit(): void;
}
/** Live, editable models use the shared player without promising reversible time. */
function mount(element: HTMLElement, model: SimulationOptions) {
  const view = PlayerControls.mount(element, { forwardOnly: true, seekable: false });
  const abort = new AbortController(),
    listen = { signal: abort.signal };
  let playing = false,
    frame = 0,
    disposed = false;
  function update() {
    const state = model.read();
    view.update({
      value: state.value,
      paused: !playing,
      ended: state.done,
      stamp: state.stamp,
      canNext: state.canStep ?? true,
    });
    element.dataset.playing = String(playing);
  }
  function pause(persist = true) {
    const wasPlaying = playing;
    playing = false;
    cancelAnimationFrame(frame);
    frame = 0;
    update();
    if (persist && wasPlaying) model.commit();
  }
  function play() {
    if (disposed || playing) return;
    model.prepare();
    playing = true;
    model.render();
    update();
    model.commit();
    const started = performance.now();
    function tick(now: number) {
      if (!playing || disposed) return;
      if (model.advance(now - started)) model.render();
      update();
      if (model.read().done) {
        pause(false);
        model.commit();
      } else frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  }
  function step() {
    if (disposed || model.read().canStep === false) return;
    pause(false);
    model.step();
    model.render();
    update();
    model.commit();
  }
  view.play.addEventListener('click', () => (playing ? pause() : play()), listen);
  view.next!.addEventListener('click', step, listen);
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.hidden) pause();
    },
    listen,
  );
  update();
  return {
    view,
    update,
    pause,
    play,
    step,
    get playing() {
      return playing;
    },
    dispose() {
      pause(false);
      disposed = true;
      abort.abort();
      element.replaceChildren();
    },
  };
}
export const SimulationPlayer = { mount };
