import { html } from '../ink/dom.js';
import type { Transport } from '../story/transport.js';
import { PlayerControls } from './player-view.js';
import type { CaptionTrack } from '../story/captions.js';

export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export interface PlayerOptions {
  transport: Transport;
  stops?: readonly number[];
  captions?: { element: HTMLElement; track: Pick<CaptionTrack, 'at'> };
  onSeek?: (time: number) => void;
  onPlay?: () => void;
}
/** The continuous-story adapter uses the same view as audio, steps and native SVG. */
export function player(parent: HTMLElement, options: PlayerOptions) {
  const clock = options.transport,
    element = html('div', 'vs-player');
  parent.append(element);
  const view = PlayerControls.mount(element, {
    chapters: true,
    sound: clock.state.hasAudio,
    speed: true,
    max: clock.state.duration,
    label: 'Позиция рассказа',
  });
  const seek = options.onSeek ?? clock.seek,
    abort = new AbortController(),
    listen = { signal: abort.signal };
  const stops = [...new Set([0, ...(options.stops ?? []), clock.state.duration])].sort(
    (a, b) => a - b,
  );
  const error = html('p', 've-status');
  error.setAttribute('role', 'alert');
  parent.append(error);
  view.play.addEventListener(
    'click',
    () => {
      options.onPlay?.();
      void Promise.resolve(clock.toggle()).catch(() => {});
    },
    listen,
  );
  view.back!.addEventListener(
    'click',
    () => seek([...stops].reverse().find((t) => t < clock.state.time - 0.3) ?? 0),
    listen,
  );
  view.next!.addEventListener(
    'click',
    () => seek(stops.find((t) => t > clock.state.time + 0.05) ?? clock.state.duration),
    listen,
  );
  view.seek.addEventListener('input', () => seek(view.seek.valueAsNumber), listen);
  view.mute?.addEventListener(
    'click',
    () => {
      void clock.mute().catch(() => {});
    },
    listen,
  );
  view.rate?.addEventListener('change', () => clock.rate(Number(view.rate!.value)), listen);
  const unsubscribe = clock.subscribe((state) => {
    const stamp = `${formatTime(state.time)} / ${formatTime(state.duration)}`;
    view.update({
      value: state.time,
      paused: !state.playing,
      ended: state.time >= state.duration,
      stamp,
      valueText: stamp,
      canBack: state.time > 0.01,
      canNext: state.time < state.duration,
      muted: state.muted,
      rate: state.rate,
    });
    error.textContent = state.error;
    if (options.captions) {
      const { element, track } = options.captions;
      const text = track.at(state.time);
      if (element.textContent !== text) element.textContent = text;
    }
  });
  return {
    element,
    dispose() {
      unsubscribe();
      abort.abort();
      view.dispose();
      element.remove();
      error.remove();
    },
  };
}
