import { object, lettering, symbol, type Surface } from '@visual-storytelling/core';
import { circuitGeometry, linePath } from './geometry';
import type { OscillatorState } from './model';

export function circuit(view: Surface, width: number) {
  const g = circuitGeometry(width);
  const { left, right, top, bottom, plateTop, plateBottom, plateHalf, radius, compact } = g;
  const cap = object(view.layer, 'capacitor', 'ochre');
  const labelSize = compact ? 17 : 23;
  lettering(view.layer, 'Конденсатор C', { x: left, y: 24, size: labelSize });
  lettering(view.layer, 'Катушка L', { x: right, y: 24, size: labelSize });
  const field = object(view.layer, 'magnetic-field', 'purple');
  const fluxArrows = [-1, 1]
    .map((side) => {
      const inner = right + side * 9,
        outer = right + side * (radius + (compact ? 18 : 31));
      view.pen.path(
        field.content,
        `flux:${side}`,
        `M${inner} ${top + 12} C${inner + side} ${top + 100} ${inner - side} ${bottom - 80} ${inner} ${bottom - 6} C${inner} ${bottom + 40} ${outer} ${bottom + 40} ${outer} ${bottom - 4} C${outer + side * 3} ${bottom - 85} ${outer + side * 3} ${top + 95} ${outer} ${top + 12} C${outer} ${top - 36} ${inner} ${top - 36} ${inner} ${top + 12} Z`,
        { width: 1 },
      );
      return [inner, outer].map((x, i) => {
        const arrow = object(field.content, `flux-head:${side}:${i}`, 'purple');
        arrow.at(x, (top + bottom) / 2);
        view.pen.path(arrow.content, `flux-head:${side}:${i}:shape`, 'M-3 -5 Q0 0 3 -5', {
          width: 1.3,
        });
        return { arrow, direction: i === 0 ? 1 : -1 };
      });
    })
    .flat();
  const poleTop = object(view.layer, 'pole-top', 'purple'),
    poleBottom = object(view.layer, 'pole-bottom', 'purple');
  poleTop.at(right, top - 12);
  poleBottom.at(right, bottom + 29);
  const topText = lettering(poleTop.content, 'S', { size: 20 });
  const bottomText = lettering(poleBottom.content, 'N', { size: 20 });
  const wire = object(view.layer, 'conductor');
  view.pen.path(wire.content, 'wire-upper', linePath(g.upper), { width: 1.7 });
  view.pen.path(wire.content, 'wire-lower', linePath(g.lower), { width: 1.7 });
  const coil = object(view.layer, 'coil', 'ochre');
  const boundaries = [0, ...Array.from({ length: 27 }, (_, i) => 20 + i * 20), g.coil.length - 1];
  for (const front of [false, true])
    for (let i = 0; i < boundaries.length - 1; i++) {
      const first = boundaries[i]!,
        last = boundaries[i + 1]!;
      if (g.coil[Math.floor((first + last) / 2)]!.front !== front) continue;
      const curve = view.pen.path(
        coil.content,
        `coil:${i}`,
        linePath(g.coil.slice(first, last + 1).map((p) => p.point)),
        { width: front ? 2.8 : 1.9 },
      );
      curve.element.style.opacity = front ? '1' : '.40';
    }
  for (const [name, y] of [
    ['upper', plateTop],
    ['lower', plateBottom],
  ] as const)
    view.pen.line(cap.content, `plate:${name}`, [left - plateHalf, y], [left + plateHalf, y], {
      width: 2.8,
    });
  const charges = Array.from({ length: 12 }, (_, i) => {
    const mark = object(view.layer, `charge-pair:${i}`);
    const upper = object(mark.content, `charge-top:${i}`, 'ochre');
    const lower = object(mark.content, `charge-bottom:${i}`, 'blue');
    return {
      mark,
      upper,
      lower,
      a: lettering(upper.content, '+', { y: plateTop - 9, size: 13 }),
      b: lettering(lower.content, '−', { y: plateBottom + 17, size: 13 }),
    };
  });
  const electric = object(view.layer, 'electric-field', 'ochre');
  const electricArrows = [-0.55, 0, 0.55].map((offset, i) => {
    const mark = object(electric.content, `electric:${i}`, 'ochre');
    mark.at(left + plateHalf * offset, (plateTop + plateBottom) / 2);
    view.pen.arrow(mark.content, `electric:${i}:arrow`, [0, -13], [0, 13], { width: 1.3 });
    return mark;
  });
  lettering(electric.content, 'E', {
    x: left - plateHalf - 12,
    y: (plateTop + plateBottom) / 2 + 7,
    size: 19,
  });
  const neutral = object(view.layer, 'no-charge');
  lettering(neutral.content, 'Q = 0', { x: left, y: (plateTop + plateBottom) / 2 + 5, size: 17 });
  const noField = object(view.layer, 'no-field');
  lettering(noField.content, 'B = 0', { x: right, y: bottom + 29, size: 17 });
  const carriers = Array.from({ length: 24 }, (_, i) => {
    const dot = object(view.layer, `electron:${i}`, 'blue');
    view.pen.ellipse(dot.content, `electron:${i}:circle`, 0, 0, compact ? 2.8 : 3.4, undefined, {
      width: 1.3,
    });
    view.pen.line(dot.content, `electron:${i}:minus`, [-1.2, 0], [1.2, 0], { width: 1.1 });
    return dot;
  });
  const direction = (id: string, y: number, label: string) => {
    const mark = object(view.layer, id, 'blue');
    mark.at((left + right) / 2, y);
    const arrow = object(mark.content, `${id}:direction`, 'blue');
    view.pen.arrow(arrow.content, `${id}:arrow`, [-21, 0], [21, 0], { width: 1.4 });
    if (label === 'e')
      symbol(mark.content, `${id}:label`, 'e', {
        x: 0,
        y: 23,
        size: 17,
        sup: '−',
        pigment: 'blue',
      });
    else lettering(mark.content, label, { y: -10, size: 19 });
    return { mark, arrow };
  };
  const current = direction('current', top - 14, 'i');
  const electrons = direction('electron-motion', top + 20, 'e');
  return {
    geometry: g,
    render(state: OscillatorState, reduced: boolean) {
      const q = state.charge,
        i = state.current;
      charges.forEach(({ mark, upper, lower, a, b }, index) => {
        const x = ((index - 5.5) * (compact ? 11 : 14)) / Math.max(0.001, Math.abs(q));
        mark.at(left + x, 0);
        mark.show(Math.abs(q) > 1e-6 && Math.abs(x) < plateHalf - 4);
        a.text(q >= 0 ? '+' : '−');
        b.text(q >= 0 ? '−' : '+');
        upper.pigment(q >= 0 ? 'ochre' : 'blue');
        lower.pigment(q >= 0 ? 'blue' : 'ochre');
      });
      electric.show(Math.abs(q) > 0.015);
      electric.element.style.opacity = String(Math.abs(q));
      electricArrows.forEach((mark) => mark.move(0, 0, q >= 0 ? 0 : 180));
      neutral.show(Math.abs(q) < 1e-6);
      field.show(Math.abs(i) > 0.015);
      field.element.style.opacity = String(0.25 + 0.6 * Math.abs(i));
      fluxArrows.forEach(({ arrow, direction }) => arrow.move(0, 0, i * direction >= 0 ? 0 : 180));
      for (const pole of [poleTop, poleBottom]) pole.show(Math.abs(i) > 0.06);
      topText.text(i >= 0 ? 'S' : 'N');
      bottomText.text(i >= 0 ? 'N' : 'S');
      noField.show(Math.abs(i) < 1e-6);
      for (const [flow, sign] of [
        [current, 1],
        [electrons, -1],
      ] as const) {
        flow.mark.show(Math.abs(i) > 0.015);
        flow.arrow.move(0, 0, i * sign >= 0 ? 0 : 180);
      }
      const pitch = g.length / carriers.length;
      carriers.forEach((dot, index) => {
        const position = g.at((index + 0.5) * pitch + 0.24 * pitch * (reduced ? 0 : q));
        dot.at(position.x, position.y);
        dot.element.style.opacity = String(position.depth);
      });
      view.element.dataset.polarity = q >= 0 ? 'positive' : 'negative';
      view.element.dataset.current = String(i);
    },
  };
}
