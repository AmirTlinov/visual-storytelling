import {
  notebook,
  surface,
  composition,
  object,
  lettering,
  formula,
  range,
  story,
} from '@visual-storytelling/core';
import { oscillator } from './model';
import type { Example } from '../types';

export function mount(parent: HTMLElement): Example {
  const book = notebook(parent, {
    title: 'Куда перетекает энергия?',
    subtitle: 'Идеальный LC-контур: электрическое поле ↔ магнитное поле.',
  });
  function draw(width: number) {
    const small = width < 520,
      left = small ? 58 : width * 0.24,
      right = small ? width - 58 : width * 0.76,
      top = 65,
      bottom = 250;
    const view = surface(book.stage, {
      id: 'lc',
      width,
      height: 430,
      title: 'Колебательный контур',
      description:
        'Заряд конденсатора и ток в катушке меняются. Сумма энергий остаётся равной единице.',
    });
    const wire = object(view.layer, 'wire');
    view.pen.path(
      wire.content,
      'wire:path',
      `M${left} 140 V${top + 5} Q${left} ${top} ${left + 5} ${top} H${right - 5} Q${right} ${top} ${right} ${top + 5} V105 M${right} 205 V${bottom - 5} Q${right} ${bottom} ${right - 5} ${bottom} H${left + 5} Q${left} ${bottom} ${left} ${bottom - 5} V174`,
    );
    const capacitor = object(view.layer, 'capacitor', 'blue');
    capacitor.at(left, 157);
    view.pen.line(capacitor.content, 'plate-upper', [-28, -17], [28, -17], { width: 2.6 });
    view.pen.line(capacitor.content, 'plate-lower', [-28, 17], [28, 17], { width: 2.6 });
    const electricFill = view.pen.rect(capacitor.content, 'electric-field', -26, -15, 52, 30, {
      fill: 'marker',
      width: 0.1,
    });
    const charge = lettering(capacitor.content, '+', { x: 0, y: -29, size: 24 });
    const negative = lettering(capacitor.content, '−', { x: 0, y: 45, size: 24 });
    const capLabel = lettering(capacitor.content, 'C', { x: small ? -38 : -48, y: 8, size: 25 });
    capLabel.write(1);
    const coil = object(view.layer, 'coil', 'ochre');
    coil.at(right, 105);
    const loops = Array.from(
      { length: 5 },
      (_, i) => `C-25 ${i * 20} -25 ${(i + 1) * 20} 0 ${(i + 1) * 20}`,
    ).join(' ');
    view.pen.path(coil.content, 'coil:path', `M0 0 ${loops}`, { width: 2.4 });
    lettering(coil.content, 'L', { x: 32, y: 60, size: 25 });
    const field = object(view.layer, 'magnetic-field', 'ochre');
    field.at(right - 10, 155);
    const rings = Array.from({ length: 3 }, (_, i) =>
      view.pen.ellipse(field.content, `magnetic-${i}`, 0, 0, 30 + i * 9, 40 + i * 15, {
        width: 0.9,
      }),
    );
    const flow = object(view.layer, 'current', 'purple');
    flow.at(width / 2, top);
    const currentArrow = view.pen.arrow(flow.content, 'current-arrow', [-24, -13], [24, -13]);
    const current = lettering(flow.content, 'I', { y: -27, size: 22 });
    current.write(1);
    const energy = lettering(view.layer, 'Энергия переходит между полями', {
      x: width / 2,
      y: 305,
      size: small ? 17 : 22,
    });
    energy.write(1);
    const labels = formula(
      view.layer,
      'energy',
      [
        { id: 'electric', text: '1.00', pigment: 'blue' },
        { id: 'plus', text: '+' },
        { id: 'magnetic', text: '0.00', pigment: 'ochre' },
        { id: 'equals', text: '=' },
        { id: 'total', text: '1', pigment: 'green' },
      ] as const,
      31,
    );
    labels.at(width / 2, 352);
    const caption = formula(
      view.layer,
      'energy-symbols',
      [
        { id: 'electric', text: 'E поля C', pigment: 'blue' },
        { id: 'plus', text: '+' },
        { id: 'magnetic', text: 'E поля L', pigment: 'ochre' },
      ] as const,
      small ? 16 : 21,
    );
    caption.at(width / 2, 393);
    return {
      view,
      dispose: view.dispose,
      render(state: ReturnType<typeof oscillator>, reduced: boolean) {
        const sign = state.charge >= 0 ? '＋' : '−';
        charge.text(sign);
        negative.text(state.charge >= 0 ? '−' : '＋');
        charge.write(Math.abs(state.charge) > 0.035 ? 1 : 0);
        negative.write(Math.abs(state.charge) > 0.035 ? 1 : 0);
        electricFill.element.style.opacity = String(state.electric);
        rings.forEach((ring) => {
          ring.element.style.opacity = String(state.magnetic * 0.8);
        });
        flow.show(Math.abs(state.current) > 0.035);
        currentArrow.element.setAttribute(
          'transform',
          state.current >= 0 ? '' : 'translate(0 -26) rotate(180)',
        );
        labels.substitute('electric', state.electric.toFixed(2));
        labels.substitute('magnetic', state.magnetic.toFixed(2));
        view.element.dataset.reduced = String(reduced);
        view.element.dataset.energy = String(state.electric + state.magnetic);
      },
    };
  }
  const layout = composition(book.stage, draw, () => controller.update());
  const script = {
    duration: 12,
    cues: {
      charge: { start: 0, end: 1 },
      current: { start: 1.5, end: 2 },
      reversed: { start: 3, end: 4 },
    },
    segments: [
      { id: 'electric', start: 0, end: 1.5, text: 'Энергия в электрическом поле конденсатора.' },
      {
        id: 'magnetic',
        start: 1.5,
        end: 3,
        text: 'Конденсатор разрядился. Энергия в магнитном поле катушки.',
      },
      { id: 'reverse', start: 3, end: 6, text: 'Конденсатор зарядился с обратным знаком.' },
      { id: 'repeat', start: 6, end: 12, text: 'Цикл повторяется. Сумма энергий постоянна.' },
    ],
  };
  const controller = story({
    script,
    stateAt: (frame) =>
      oscillator(frame.reduced ? Math.floor(frame.time / 1.5) * 1.5 : frame.time, 6),
    render: (state, frame) => layout.current.render(state, frame.reduced),
  });
  const phase = range({
    label: 'Фаза колебания',
    min: 0,
    max: 360,
    step: 1,
    value: 0,
    format: (value) => `${value}°`,
    onInput: (value) => controller.explore(oscillator((value / 360) * 6, 6)),
  });
  const unsubscribe = controller.subscribe((_, state) =>
    phase.set(((state.time / state.period) * 360) % 360),
  );
  book.parameters.append(phase.element);
  book.attach(controller);
  return {
    duration: 12,
    checkpoints: [0, 0.75, 1.5, 3, 4.5],
    seek: controller.seek,
    pause: controller.player.pause,
    setTheme: book.theme,
    setReduced: controller.setReduced,
    svg: () => layout.current.view.element,
    snapshot: () => controller.values,
    dispose() {
      unsubscribe();
      phase.dispose();
      book.dispose();
      layout.dispose();
    },
  };
}
