import { html } from '../ink/dom.js';
import type { Transport } from '../story/transport.js';
import { button } from './button.js';

export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export interface PlayerOptions {
  transport: Transport;
  stops?: readonly number[];
  onSeek?: (time: number) => void;
  onPlay?: () => void;
}
export function player(parent: HTMLElement, options: PlayerOptions) {
  const clock = options.transport;
  const element = html('div', 'vs-player');
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Управление рассказом');
  const seek = options.onSeek ?? clock.seek;
  const stops = [...new Set([0, ...(options.stops ?? []), clock.state.duration])].sort(
    (a, b) => a - b,
  );
  const play = button(
    'Воспроизвести',
    () => {
      options.onPlay?.();
      void clock.toggle();
    },
    'play',
  );
  const previous = button(
    'Предыдущий шаг',
    () => seek([...stops].reverse().find((time) => time < clock.state.time - 0.3) ?? 0),
    'previous',
  );
  const next = button(
    'Следующий шаг',
    () => seek(stops.find((time) => time > clock.state.time + 0.05) ?? clock.state.duration),
    'next',
  );
  const sound = button('Выключить звук', () => clock.mute(), 'sound');
  const scrubber = html('input', 'vs-range');
  scrubber.type = 'range';
  scrubber.min = '0';
  scrubber.max = String(clock.state.duration);
  scrubber.step = '.01';
  scrubber.setAttribute('aria-label', 'Позиция рассказа');
  const input = () => seek(scrubber.valueAsNumber);
  scrubber.addEventListener('input', input);
  const time = html('span', 'vs-time');
  time.setAttribute('aria-hidden', 'true');
  const error = html('p', 'vs-status');
  error.setAttribute('role', 'alert');
  element.append(play.element, previous.element, next.element, scrubber, time);
  if (clock.state.hasAudio) element.append(sound.element);
  parent.append(element, error);
  const unsubscribe = clock.subscribe((state) => {
    play.set(state.playing ? 'Пауза' : 'Воспроизвести', state.playing ? 'pause' : 'play');
    sound.set(state.muted ? 'Включить звук' : 'Выключить звук', state.muted ? 'muted' : 'sound');
    scrubber.value = String(state.time);
    scrubber.style.setProperty('--vs-progress', `${(100 * state.time) / state.duration}%`);
    scrubber.setAttribute(
      'aria-valuetext',
      `${formatTime(state.time)} из ${formatTime(state.duration)}`,
    );
    time.textContent = `${formatTime(state.time)} / ${formatTime(state.duration)}`;
    error.textContent = state.error;
    previous.element.disabled = state.time < 0.01;
    next.element.disabled = state.time >= state.duration;
  });
  return {
    element,
    dispose() {
      unsubscribe();
      for (const control of [play, previous, next, sound]) control.dispose();
      scrubber.removeEventListener('input', input);
      element.remove();
      error.remove();
    },
  };
}
