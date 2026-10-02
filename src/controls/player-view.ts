export interface PlayerState {
  value: number;
  paused: boolean;
  ended?: boolean;
  stamp: string;
  valueText?: string;
  canBack?: boolean;
  canNext?: boolean;
  muted?: boolean;
}

/* One player view; audio, step and SVG controllers own their respective clocks. */

const icons = {
  play: {
    play: 'M8 4.8L19.1 12L8.2 19.2Z',
    pause: 'M8 5.7L8.2 18.2M15.8 5.9L15.6 18',
    replay: 'M19 9C17 3 7 3 4.5 10C2 17 11 23 17.7 18M19 3.8L19 9.2L13.7 9',
  },
  back: { arrow: 'M19 12.2Q12 11.3 5 12M11 6.8L4.8 12L11.2 17.3' },
  next: { arrow: 'M5 11.8Q12 12.7 19 12M12.8 6.7L19.2 12L13 17.2' },
  mute: {
    speaker: 'M4 9.2L7.5 9.1L13 4.8L12.8 19.1L7.3 14.9L4.1 15Z',
    sound: 'M16 8Q19.5 12 16 16M18.6 5.2Q24 12 18.6 18.8',
    muted: 'M17 8.8L22 15.2M22 8.8L17 15.2',
  },
};
function mount(
  element: HTMLElement,
  {
    chapters = false,
    sound = false,
    max = 1,
    step = 0.01,
    label = 'Позиция воспроизведения',
  }: { chapters?: boolean; sound?: boolean; max?: number; step?: number; label?: string } = {},
) {
  element.classList.add('ve-player');
  element.setAttribute('role', 'group');
  element.setAttribute('aria-label', 'Плеер');
  element.replaceChildren();
  const button = (key: keyof typeof icons, label: string) => {
    const node = document.createElement('button');
    node.type = 'button';
    node.dataset[key] = '';
    node.setAttribute('aria-label', label);
    node.title = label;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    for (const [name, d] of Object.entries(icons[key])) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('data-icon', name);
      path.setAttribute('d', d);
      svg.append(path);
    }
    node.append(svg);
    element.append(node);
    return node;
  };
  const play = button('play', 'Воспроизвести');
  const back = chapters ? button('back', 'Предыдущий шаг') : null;
  const next = chapters ? button('next', 'Следующий шаг') : null;
  const seek = document.createElement('input');
  Object.assign(seek, { type: 'range', min: 0, max, step, value: 0 });
  seek.dataset.seek = '';
  seek.setAttribute('aria-label', label);
  const time = document.createElement('output');
  time.className = 'time';
  time.dataset.time = '';
  time.setAttribute('aria-live', 'off');
  element.append(seek, time);
  const mute = sound ? button('mute', 'Выключить звук') : null;
  function update({
    value,
    paused,
    ended = false,
    stamp,
    valueText,
    canBack,
    canNext,
    muted = false,
  }: PlayerState) {
    seek.value = String(value);
    if (valueText) seek.setAttribute('aria-valuetext', valueText);
    if (time.textContent !== stamp) time.textContent = stamp;
    play.dataset.playback = ended ? 'ended' : paused ? 'paused' : 'playing';
    const label = ended ? 'Повторить' : paused ? 'Воспроизвести' : 'Пауза';
    play.setAttribute('aria-label', label);
    play.title = label;
    if (back) back.disabled = !canBack;
    if (next) next.disabled = !canNext;
    if (mute) {
      const label = muted ? 'Включить звук' : 'Выключить звук';
      mute.setAttribute('aria-label', label);
      mute.title = label;
      mute.setAttribute('aria-pressed', String(!muted));
    }
  }
  update({ value: 0, paused: true, stamp: '' });
  return { element, play, back, next, seek, time, mute, update };
}
export const PlayerControls = { mount };
