import { SimulationPlayer, type SimulationOptions } from './simulation.js';
import type { SceneHandle } from '../scene-handle.js';
import { releaseResources } from '../lifecycle.js';
const owners = new WeakSet<SceneHandle>();
interface StoryClock {
  readonly requested: object;
  readonly currentTime: number;
  player: { readonly state: { playing: boolean } };
  pause(): void;
  ready(): Promise<void>;
  update(): void;
  subscribe(listener: () => void): () => void;
}
/** Explicit handoff: Story is paused while the existing forward-only player owns time. */
function mount(options: {
  scene: SceneHandle;
  story: StoryClock;
  element: HTMLElement;
  model: SimulationOptions;
  time(): number;
  snapshot(): unknown;
  checkpoint: {
    start(): unknown;
    capture(): unknown;
    validate(value: unknown): void;
    restore(value: unknown): void;
  };
  onMode?(live: boolean): void;
}) {
  const { scene, story, element } = options;
  if (owners.has(scene)) throw new Error('A scene has only one simulation mode owner.');
  const delegated = Object.defineProperties(
    {},
    Object.getOwnPropertyDescriptors(scene),
  ) as SceneHandle;
  const liveElement = document.createElement('div');
  liveElement.hidden = true;
  element.after(liveElement);
  let player: ReturnType<typeof SimulationPlayer.mount> | undefined;
  let frozen: object | undefined;
  let request = 0,
    disposed = false;
  let wasHidden = element.hidden;
  let resumed: { anchor: string; state: unknown } | undefined;
  let anchored = '';
  let unregister = () => {};
  const active = () => Boolean(player);
  const anchor = () => {
    const position = scene.capture({ basis: 'requested' });
    return JSON.stringify([position.time, position.mode, position.values, position.subject]);
  };
  function leave(refresh = true, remember = true) {
    request++;
    if (!player) return;
    resumed = remember ? { anchor: anchored, state: options.checkpoint.capture() } : undefined;
    const previous = player;
    player = undefined;
    previous.dispose();
    liveElement.hidden = true;
    element.hidden = wasHidden;
    try {
      options.onMode?.(false);
    } finally {
      if (refresh) story.update();
    }
  }
  const stop = story.subscribe(() => {
    if (active() && story.requested !== frozen && anchor() !== anchored) leave(false, false);
  });
  async function enter(restored?: unknown) {
    if (disposed) throw new Error('Simulation mode has been disposed.');
    // A failed candidate does not own the visible experiment. Restore its accepted moment first.
    if (scene.rendering?.phase === 'failed') await scene.restore(scene.capture());
    const next = ++request;
    story.pause();
    const intended = anchor();
    await story.ready();
    if (disposed || next !== request || player || anchor() !== intended) return;
    frozen = story.requested;
    anchored = anchor();
    const state =
      restored ?? (resumed?.anchor === anchored ? resumed.state : options.checkpoint.start());
    options.checkpoint.validate(state);
    options.checkpoint.restore(state);
    wasHidden = element.hidden;
    try {
      player = SimulationPlayer.mount(liveElement, options.model);
      element.hidden = true;
      liveElement.hidden = false;
      options.onMode?.(true);
    } catch (cause) {
      player?.dispose();
      player = undefined;
      liveElement.hidden = true;
      element.hidden = wasHidden;
      releaseResources(
        [
          () => {
            throw cause;
          },
          () => options.onMode?.(false),
          () => story.update(),
        ],
        'Simulation handoff preparation failed.',
      );
    }
  }
  scene.extend({
    get simulation() {
      return {
        active: active(),
        time: options.time(),
        reversible: false as const,
        storyTime: story.currentTime,
        capture: options.checkpoint.capture,
        validate: options.checkpoint.validate,
        async restore(value: unknown) {
          options.checkpoint.validate(value);
          if (!player) {
            await enter(value);
            return;
          }
          const previous = options.checkpoint.capture();
          player.pause();
          try {
            options.checkpoint.restore(value);
            options.model.render();
            player.update();
          } catch (cause) {
            options.checkpoint.restore(previous);
            options.model.render();
            player.update();
            throw cause;
          }
        },
      };
    },
    get playing() {
      return player?.playing ?? story.player.state.playing;
    },
    get rate() {
      return player ? undefined : delegated.rate;
    },
    get setRate() {
      return player ? undefined : delegated.setRate;
    },
    play() {
      return player ? player.play() : delegated.play?.();
    },
    pause() {
      if (player) player.pause();
      else delegated.pause?.();
    },
    seek(time: number) {
      leave(false, false);
      delegated.seek?.(time);
    },
    snapshot() {
      return player
        ? {
            simulation: { time: options.time(), storyTime: story.currentTime },
            content: options.snapshot(),
          }
        : delegated.snapshot();
    },
  });
  const dispose = (restore = true) => {
    if (disposed) return;
    disposed = true;
    request++;
    const previous = player;
    player = undefined;
    owners.delete(scene);
    unregister();
    const restoreStory = () => {
      if (restore) {
        element.hidden = wasHidden;
        for (const key of ['playing', 'rate', 'setRate', 'play', 'pause', 'seek', 'snapshot']) {
          const descriptor = Object.getOwnPropertyDescriptor(delegated, key);
          if (descriptor) Object.defineProperty(scene, key, descriptor);
          else Reflect.deleteProperty(scene, key);
        }
        Reflect.deleteProperty(scene, 'simulation');
      }
    };
    releaseResources(
      [
        stop,
        () => previous?.dispose(),
        () => liveElement.remove(),
        restoreStory,
        () => {
          if (restore) options.onMode?.(false);
        },
        () => {
          if (restore) story.update();
        },
      ],
      'Simulation mode disposal failed.',
    );
  };
  owners.add(scene);
  unregister = scene.onDispose(() => dispose(false));
  return {
    get active() {
      return active();
    },
    /** A view can retain live drawing during refresh, while a new condition returns to Story. */
    get ownsRequested() {
      return active() && anchor() === anchored;
    },
    enter,
    leave: () => leave(),
    dispose: () => dispose(),
  };
}
export const SimulationMode = { mount };
