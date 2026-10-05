import { PlayerControls } from '../controls/player-view.js';
import { sceneHost } from '../host/adapter.js';
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
  let permission: AbortController | undefined;
  function update() {
    const state = model.read();
    view.update({
      value: state.value,
      paused: !playing && !permission,
      ended: state.done,
      stamp: state.stamp,
      canNext: state.canStep ?? true,
    });
    element.dataset.playing = String(playing);
  }
  function pause(persist = true) {
    permission?.abort();
    permission = undefined;
    const wasPlaying = playing;
    playing = false;
    cancelAnimationFrame(frame);
    frame = 0;
    update();
    if (persist && wasPlaying) model.commit();
  }
  async function play() {
    if (disposed || playing || permission) return;
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
        if (!disposed) update();
      }
      if (disposed || request.signal.aborted) return;
    }
    model.prepare();
    playing = true;
    model.render();
    update();
    model.commit();
    const started = performance.now();
    function tick(now: number) {
      if (!playing || disposed) return;
      // A callback in the current refresh cycle can predate the play handler.
      if (model.advance(Math.max(0, now - started))) model.render();
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
  view.play.addEventListener(
    'click',
    () => {
      if (playing || permission) pause();
      else
        void play().catch((error) =>
          element.dispatchEvent(
            new CustomEvent('scene-playback-error', { bubbles: true, detail: error }),
          ),
        );
    },
    listen,
  );
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
      view.dispose();
      delete element.dataset.playing;
    },
  };
}
export const SimulationPlayer = { mount };
