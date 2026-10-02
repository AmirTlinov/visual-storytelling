import { html, svg } from '../ink/dom.js';

export type Icon = 'play' | 'pause' | 'previous' | 'next' | 'sound' | 'muted';
const icons: Record<Icon, string> = {
  play: 'M14 10 Q14.4 17 14 25 Q21 21 26 17.5 Q21 14 14 10Z',
  pause: 'M14 11 Q14.5 18 14 25 M23 11 Q22.5 18 23 25',
  previous: 'M26 18 Q18 17.5 11 18 M17 12 Q14 15 11 18 Q14 21 17 24',
  next: 'M11 18 Q18 18.5 26 18 M20 12 Q23 15 26 18 Q23 21 20 24',
  sound:
    'M10 15 L14 15 Q17 12 20 10 Q20.3 18 20 26 L14 22 L10 22Z M24 14 Q28 18 24 23 M28 10 Q34 18 28 27',
  muted: 'M9 15 L13 15 L19 10 Q19.3 18 19 26 L13 22 L9 22Z M25 14 Q28 18 31 23 M31 14 Q28 18 25 23',
};
export function button(label: string, action: () => void, icon?: Icon) {
  const element = html('button', icon ? 'vs-button vs-icon-button' : 'vs-button');
  element.type = 'button';
  const text = html('span', icon ? 'vs-sr' : undefined, label);
  const drawing = svg('svg', { viewBox: '0 0 38 38', 'aria-hidden': 'true' });
  const ring = svg('path', { d: 'M18 2.7 C39 1.8 41 35.5 20 35.7 C-3 37 -3 3.7 18 2.7Z' });
  const mark = svg('path');
  if (icon) {
    mark.setAttribute('d', icons[icon]);
    drawing.append(ring, mark);
    element.append(drawing);
  }
  element.append(text);
  element.setAttribute('aria-label', label);
  element.addEventListener('click', action);
  return {
    element,
    set(next: string, nextIcon?: Icon) {
      text.textContent = next;
      element.setAttribute('aria-label', next);
      if (nextIcon) mark.setAttribute('d', icons[nextIcon]);
    },
    pressed(value: boolean) {
      element.setAttribute('aria-pressed', String(value));
    },
    dispose() {
      element.removeEventListener('click', action);
      element.remove();
    },
  };
}
