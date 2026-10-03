import { resolveMedia, SilentMedia } from './media.js';
import type { MediaClock, Timing, CueClock } from './clock.js';
export interface AudioStoryOptions {
  audio: MediaClock;
  timing: Timing;
  render(time: number, cues: CueClock, reduced: boolean): void;
  stops?: { time: number; label: string }[];
  sound?: boolean;
}
import { PlayerControls } from '../controls/player-view.js';
import { formatTime } from '../controls/player.js';
import { transport } from './transport.js';
/* Audio is the only playback clock. The scene receives time; it owns its model. */

function mount(
  root: HTMLElement,
  { audio, timing, render, stops, sound = true }: AudioStoryOptions,
) {
  audio = resolveMedia(audio, timing.duration);
  sound = sound && !(audio instanceof SilentMedia);
  const view = PlayerControls.mount(root.querySelector<HTMLElement>('[data-player]')!, {
    chapters: true,
    sound,
    max: timing.duration,
  });
  const { play, seek, mute, back, next } = view;
  const caption = root.querySelector('[data-caption]');
  const captionIsHidden = caption?.classList.contains('sr-only');
  const setCaption = (text: string, error = false) => {
    if (!caption) return;
    caption.textContent = text;
    caption.classList.toggle('sr-only', captionIsHidden && !error);
    caption.setAttribute('role', error ? 'alert' : 'status');
  };
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const chapters =
    stops || timing.segments.map((segment) => ({ time: segment.start, label: segment.text }));
  const listeners: (() => void)[] = [];
  let stage = -1;
  const on = (node: EventTarget | null, event: string, action: EventListener) => {
    if (node) {
      node.addEventListener(event, action);
      listeners.push(() => node.removeEventListener(event, action));
    }
  };
  const playback = transport({
    audio,
    duration: timing.duration,
    cues: timing.cues,
    segments: timing.segments,
  });
  const { clock } = playback;
  const unsubscribe = playback.subscribe((state) => {
    const t = state.time;
    render(t, clock, reduced.matches);
    const stamp = `${formatTime(t)} / ${formatTime(timing.duration)}`;
    view.update({
      value: t,
      paused: !state.playing,
      ended: audio.ended,
      stamp,
      valueText: stamp,
      canBack: t > 0,
      canNext: chapters.some((chapter) => chapter.time > t + 0.05),
      muted: audio.muted,
    });
    const current = Math.max(
      0,
      chapters.findLastIndex((chapter) => t >= chapter.time),
    );
    if (state.error) setCaption(state.error, true);
    else if (current !== stage || caption?.getAttribute('role') === 'alert') {
      stage = current;
      setCaption(chapters[stage]?.label || '');
    }
  });
  on(seek, 'input', () => clock.seek(Number(seek.value)));
  on(play, 'click', () => {
    void playback.toggle();
  });
  on(back, 'click', () =>
    clock.seek(
      [...chapters].reverse().find((chapter) => chapter.time < audio.currentTime - 0.15)?.time || 0,
    ),
  );
  on(next, 'click', () =>
    clock.seek(
      chapters.find((chapter) => chapter.time > audio.currentTime + 0.05)?.time ?? timing.duration,
    ),
  );
  on(mute, 'click', () => playback.mute());
  on(reduced, 'change', () => clock.update());
  clock.update();
  return {
    ...clock,
    pause: playback.pause,
    dispose() {
      unsubscribe();
      playback.dispose();
      listeners.forEach((remove) => remove());
      view.dispose();
    },
  };
}
export const SketchPlayer = { mount };
