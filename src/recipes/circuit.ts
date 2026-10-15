import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import type { Surface } from '../ink/surface.js';
import type { InkDrawing } from '../story/ink-chapter.js';
import type { ChapterFrame } from '../story/composition.js';
import { svgButton } from '../controls/svg.js';
import type { InkViewport } from '../story/ink-chapter.js';

type CircuitViewport = InkViewport & { scale?: number; text?: string };

// Subject artwork is authored once. Its coordinates belong to its own measuring surface.
export function circuitDiagram(
  view: Surface,
  options: { closed?: string; voltage?: number; modelId?: string; viewId?: string } = {},
): InkDrawing & { validate(viewport: CircuitViewport): void; dispose(): void } {
  const closedKey = options.closed ?? 'closed',
    volts = options.voltage ?? 6;
  if (!Number.isFinite(volts) || volts <= 0) throw new Error('A circuit needs a positive voltage');
  view.element.setAttribute('role', 'group');
  const modelId = options.modelId ?? 'circuit';
  const root = object(view.layer, options.viewId ?? 'circuit');
  const art = object(root.content, `${modelId}:diagram`, 'ink');
  const wire = object(art.content, `${modelId}:wire`, 'blue'),
    battery = object(art.content, `${modelId}:battery`, 'blue');
  const contact = object(art.content, `${modelId}:switch`, 'orange'),
    lamp = object(art.content, `${modelId}:lamp`, 'orange');
  wire.element.dataset.reviewId = `${modelId}.wire`;
  contact.element.dataset.reviewId = `${modelId}.switch`;
  lamp.element.dataset.reviewId = `${modelId}.lamp`;
  const line = view.pen.path(
    wire.content,
    'loop',
    'M70 120V55H270M390 55H540V95M540 155V195H70V150',
    {
      width: 3,
    },
  );
  view.pen.path(battery.content, 'battery', 'M53 120H87M61 150H79', { width: 3 });
  const blade = view.pen.path(contact.content, 'blade', 'M270 55L390 55', { width: 4 });
  for (const x of [270, 390])
    view.pen.ellipse(contact.content, `terminal-${x}`, x, 55, 4, 4, { fill: 'marker' });
  const bulb = view.pen.ellipse(lamp.content, 'bulb', 540, 125, 30, 30, {
    fill: 'marker',
    width: 2,
  });
  const filament = view.pen.path(lamp.content, 'filament', 'M519 104L561 146M561 104L519 146', {
    width: 2,
  });
  const light = object(art.content, `${modelId}:light`, 'yellow');
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    view.pen.path(
      light.content,
      `ray-${i}`,
      `M${540 + Math.cos(a) * 42} ${125 + Math.sin(a) * 42}L${540 + Math.cos(a) * 52} ${125 + Math.sin(a) * 52}`,
      { width: 3 },
    );
  }
  let latest: ChapterFrame | undefined,
    closed = true;
  contact.describe({
    label: 'Ключ',
    value: () => closed,
    inputs: () => [`${modelId}:${closedKey}`],
    interactive: false,
  });
  lamp.describe({
    label: 'Лампа светится',
    value: () => closed,
    inputs: () => [`${modelId}:${closedKey}`],
    interactive: false,
  });
  wire.describe({ label: 'Замкнутый контур', value: () => closed, interactive: false });
  let labels:
      | {
          voltage: ReturnType<typeof lettering>;
          status: ReturnType<typeof lettering>;
          caption: ReturnType<typeof lettering>;
        }
      | undefined,
    labelKey = '';
  const geometry = ({ width, height, scale: pixels = 1, text }: CircuitViewport) => {
    if (![width, height, pixels].every((value) => Number.isFinite(value) && value > 0))
      throw new Error('Circuit viewport must have positive dimensions and scale.');
    const font = Math.max(16, Math.min(24, (width * pixels) / 24)) / pixels;
    const captionHeight = text ? font * 2.3 : 0;
    const scale = Math.min(width / 640, (height - captionHeight) / 250);
    if (!(scale > 0)) throw new Error('Circuit needs room for its drawing and caption.');
    return { width, height, pixels, text, scale, font, captionHeight, diagramFont: font / scale };
  };
  const makeLabels = (viewport: CircuitViewport) => {
    const g = geometry(viewport);
    const voltage = lettering(battery.content, `${volts} В`, {
      x: 125,
      y: 140,
      size: g.diagramFont,
    });
    const status = lettering(contact.content, closed ? 'Цепь замкнута' : 'Цепь разомкнута', {
      x: 320,
      y: 245,
      size: g.diagramFont,
    });
    const caption = lettering(root.content, g.text ?? '', {
      x: g.width / 2,
      y: g.height - g.font * 0.8,
      size: g.font,
    });
    voltage.element.style.color = status.element.style.color = 'var(--ve-ink)';
    const dispose = () => {
      voltage.dispose();
      status.dispose();
      caption.dispose();
    };
    if (
      Math.max(...status.measureWidths(['Цепь замкнута', 'Цепь разомкнута'])) > 580 ||
      voltage.width > 90 ||
      caption.width > g.width * 0.94
    ) {
      dispose();
      throw new Error('Circuit text needs one short readable line.');
    }
    return { voltage, status, caption, dispose };
  };
  const button = svgButton(contact.content, {
    x: 245,
    y: 8,
    width: 170,
    height: 100,
    label: 'Замкнуть или разомкнуть цепь',
    onPress: () => latest?.input?.({ [closedKey]: !closed }),
  });
  const dots = Array.from({ length: 7 }, (_, i) => {
    const dot = object(art.content, `${modelId}:current-${i}`, 'blue');
    view.pen.ellipse(dot.content, `current-${i}`, 0, 0, 3, 3, { fill: 'marker' });
    return dot;
  });
  return {
    validate(viewport) {
      // Concealed candidate text is measured without replacing the accepted drawing.
      const candidates = makeLabels(viewport);
      candidates.dispose();
    },
    render(frame, viewport: CircuitViewport) {
      const { width, height, scale, captionHeight } = geometry(viewport);
      const key = JSON.stringify(viewport);
      if (key !== labelKey) {
        const next = makeLabels(viewport);
        labels?.voltage.dispose();
        labels?.status.dispose();
        labels?.caption.dispose();
        labels = next;
        labelKey = key;
      }
      art.element.setAttribute(
        'transform',
        `translate(${(width - 640 * scale) / 2} ${(height - captionHeight - 250 * scale) / 2}) scale(${scale})`,
      );
      latest = frame;
      closed = Boolean(frame.values[closedKey]);
      blade.update(`M270 55L390 ${closed ? 55 : 16}`);
      light.show(closed);
      bulb.element.style.opacity = closed ? '1' : '.35';
      labels!.status.text(closed ? 'Цепь замкнута' : 'Цепь разомкнута');
      button.update({ pressed: closed });
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
    },
    snapshot: () => ({ closed, voltage: volts, lamp: closed }),
    dispose() {
      button.dispose();
      line.dispose();
      blade.dispose();
      bulb.dispose();
      filament.dispose();
      labels?.voltage.dispose();
      labels?.status.dispose();
      labels?.caption.dispose();
      for (const m of [wire, battery, contact, lamp, light, ...dots, art, root]) m.dispose();
    },
  };
}
