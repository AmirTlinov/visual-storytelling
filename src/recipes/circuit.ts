import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { Surface } from '../ink/surface.js';
import type { InkDrawing } from '../story/ink-chapter.js';
import type { ChapterFrame } from '../story/composition.js';

// Subject artwork is authored once. Its coordinates belong to its own measuring surface.
export function circuitDiagram(
  view: Surface,
  options: { closed?: string; voltage?: number } = {},
): InkDrawing {
  const closedKey = options.closed ?? 'closed',
    volts = options.voltage ?? 6;
  if (!Number.isFinite(volts) || volts <= 0) throw new Error('A circuit needs a positive voltage');
  view.element.setAttribute('role', 'group');
  const art = object(view.layer, 'circuit', 'ink');
  const wire = object(art.content, 'wire', 'blue'),
    battery = object(art.content, 'battery', 'blue');
  const contact = object(art.content, 'switch', 'orange'),
    lamp = object(art.content, 'lamp', 'orange');
  wire.element.dataset.reviewId = 'circuit.wire';
  contact.element.dataset.reviewId = 'circuit.switch';
  lamp.element.dataset.reviewId = 'circuit.lamp';
  const line = view.pen.path(wire.content, 'loop', 'M70 120V55H270M390 55H540V195H70V150', {
    width: 3,
  });
  view.pen.path(battery.content, 'battery', 'M53 120H87M61 150H79', { width: 3 });
  const voltage = lettering(battery.content, `${volts} В`, { x: 40, y: 143, size: 30 });
  const blade = view.pen.path(contact.content, 'blade', 'M270 55L385 55', { width: 4 });
  for (const x of [270, 390])
    view.pen.ellipse(contact.content, `terminal-${x}`, x, 55, 4, 4, { fill: 'marker' });
  const bulb = view.pen.ellipse(lamp.content, 'bulb', 540, 125, 30, 30, {
    fill: 'marker',
    width: 2,
  });
  const filament = view.pen.path(lamp.content, 'filament', 'M519 104L561 146M561 104L519 146', {
    width: 2,
  });
  const status = lettering(contact.content, '', { x: 320, y: 130, size: 32 });
  status.element.style.color = 'var(--ve-ink)';
  voltage.element.style.color = 'var(--ve-ink)';
  const light = object(art.content, 'light', 'yellow');
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    view.pen.path(
      light.content,
      `ray-${i}`,
      `M${540 + Math.cos(a) * 42} ${125 + Math.sin(a) * 42}L${540 + Math.cos(a) * 52} ${125 + Math.sin(a) * 52}`,
      { width: 3 },
    );
  }
  const button = globalThis.document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  for (const [name, value] of Object.entries({
    x: 245,
    y: 8,
    width: 170,
    height: 100,
    fill: 'transparent',
    tabindex: 0,
    role: 'button',
    'aria-label': 'Замкнуть или разомкнуть цепь',
  }))
    button.setAttribute(name, String(value));
  contact.content.append(button);
  let latest: ChapterFrame | undefined,
    closed = true;
  const toggle = () => latest?.input?.({ [closedKey]: !closed });
  button.addEventListener('click', toggle);
  button.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === ' ' || (e as KeyboardEvent).key === 'Enter') {
      e.preventDefault();
      toggle();
    }
  });
  const dots = Array.from({ length: 7 }, (_, i) => {
    const dot = object(art.content, `current-${i}`, 'blue');
    view.pen.ellipse(dot.content, `current-${i}`, 0, 0, 3, 3, { fill: 'marker' });
    return dot;
  });
  return {
    render(frame, { width, height }) {
      const scale = Math.min(width / 640, height / 250);
      art.element.setAttribute(
        'transform',
        `translate(${(width - 640 * scale) / 2} ${(height - 250 * scale) / 2}) scale(${scale})`,
      );
      latest = frame;
      closed = Boolean(frame.values[closedKey]);
      blade.update(`M270 55L385 ${closed ? 55 : 16}`);
      light.show(closed);
      bulb.element.style.opacity = closed ? '1' : '.35';
      status.text(closed ? 'Цепь замкнута' : 'Цепь разомкнута');
      button.setAttribute('aria-pressed', String(closed));
      const loop = [
          [70, 55],
          [540, 55],
          [540, 195],
          [70, 195],
          [70, 55],
        ],
        lengths = [470, 140, 470, 140],
        total = 1220;
      dots.forEach((dot, i) => {
        dot.show(closed && !frame.reduced);
        let d = (((frame.time * 85 + (i * total) / dots.length) % total) + total) % total;
        for (let j = 0; j < 4; j++) {
          if (d <= lengths[j]!) {
            const p = d / lengths[j]!;
            dot.at(
              loop[j]![0]! + (loop[j + 1]![0]! - loop[j]![0]!) * p,
              loop[j]![1]! + (loop[j + 1]![1]! - loop[j]![1]!) * p,
            );
            break;
          }
          d -= lengths[j]!;
        }
      });
      view.element.querySelector('desc')!.textContent = closed
        ? 'Путь тока замкнут, лампа светится.'
        : 'В цепи разрыв, лампа погасла.';
    },
    snapshot: () => ({ closed, voltage: volts, lamp: closed }),
    dispose() {
      line.dispose();
      blade.dispose();
      bulb.dispose();
      filament.dispose();
      voltage.dispose();
      status.dispose();
      for (const m of [wire, battery, contact, lamp, light, ...dots, art]) m.dispose();
    },
  };
}
