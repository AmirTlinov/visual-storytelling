import {
  notebook,
  surface,
  composition,
  object,
  lettering,
  formula,
  range,
  story,
  interpolate,
} from '@visual-storytelling/core';
import { transform, type VectorState } from './model';
import type { Example } from '../types';

export function mount(parent: HTMLElement): Example {
  const book = notebook(parent, {
    title: 'Матрица меняет вектор',
    subtitle: 'Два коэффициента — два независимых масштаба.',
  });
  function draw(width: number) {
    const unit = Math.min(40, (width - 70) / 8),
      cx = width / 2,
      cy = 174;
    const view = surface(book.stage, {
      id: 'vector',
      width,
      height: 420,
      title: 'Действие диагональной матрицы',
      description:
        'Синий входной вектор умножается на два коэффициента. Фиолетовый вектор показывает результат.',
      grid: { step: unit / 2, x: cx, y: cy },
    });
    const axes = object(view.layer, 'axes');
    view.pen.arrow(axes.content, 'x-axis', [cx - 3.8 * unit, cy], [cx + 3.8 * unit, cy], {
      width: 1,
      pencil: true,
    });
    view.pen.arrow(axes.content, 'y-axis', [cx, cy + 2.6 * unit], [cx, cy - 2.6 * unit], {
      width: 1,
      pencil: true,
    });
    lettering(axes.content, 'x', { x: cx + 3.9 * unit, y: cy + 22, size: 20 });
    lettering(axes.content, 'y', { x: cx + 18, y: cy - 2.6 * unit, size: 20 });
    const incoming = object(view.layer, 'input', 'blue'),
      outgoing = object(view.layer, 'output', 'purple');
    incoming.at(cx, cy);
    outgoing.at(cx, cy);
    const inputLine = view.pen.arrow(incoming.content, 'input:arrow', [0, 0], [100, 0], {
      width: 2.2,
    });
    const outputLine = view.pen.arrow(outgoing.content, 'output:arrow', [0, 0], [100, 0], {
      width: 2.2,
    });
    for (const path of [
      ...inputLine.element.querySelectorAll('path'),
      ...outputLine.element.querySelectorAll('path'),
    ])
      path.setAttribute('vector-effect', 'non-scaling-stroke');
    const inputLabel = object(view.layer, 'input-label', 'blue'),
      outputLabel = object(view.layer, 'output-label', 'purple');
    const inputText = lettering(inputLabel.content, 'x', { size: 21 }),
      outputText = lettering(outputLabel.content, 'Ax', { size: 21 });
    const eq = formula(
      view.layer,
      'transform',
      [
        { id: 'a', text: '1.00', pigment: 'ochre' },
        { id: 'times', text: '×' },
        { id: 'x', text: '1.50', pigment: 'blue' },
        { id: 'equals', text: '=' },
        { id: 'out', text: '1.50', pigment: 'purple' },
      ] as const,
      width < 440 ? 23 : 30,
    );
    eq.at(width / 2, 342);
    const eqY = formula(
      view.layer,
      'transform-y',
      [
        { id: 'b', text: '1.00', pigment: 'ochre' },
        { id: 'times', text: '×' },
        { id: 'y', text: '1.00', pigment: 'blue' },
        { id: 'equals', text: '=' },
        { id: 'out', text: '1.00', pigment: 'purple' },
      ] as const,
      width < 440 ? 23 : 30,
    );
    eqY.at(width / 2, 392);
    const xLabel = lettering(view.layer, 'x:', {
      x: width / 2 - eq.width / 2 - 25,
      y: 342,
      size: 20,
    });
    const yLabel = lettering(view.layer, 'y:', {
      x: width / 2 - eqY.width / 2 - 25,
      y: 392,
      size: 20,
    });
    xLabel.write(1);
    yLabel.write(1);
    return {
      view,
      dispose: view.dispose,
      render(state: VectorState) {
        const output = transform(state);
        const orient = (mark: typeof incoming, x: number, y: number) => {
          mark.move(0, 0, (Math.atan2(-y, x) * 180) / Math.PI);
          mark.content.firstElementChild!.setAttribute(
            'transform',
            `scale(${(Math.hypot(x, y) * unit) / 100} 1)`,
          );
          mark.show(Math.hypot(x, y) > 0.001);
        };
        orient(incoming, state.x, state.y);
        orient(outgoing, output.x, output.y);
        inputLabel.at(cx + state.x * unit - 16, cy - state.y * unit + 26);
        outputLabel.at(cx + output.x * unit + 18, cy - output.y * unit - 12);
        inputText.text('x');
        outputText.text('Ax');
        eq.substitute('a', state.a.toFixed(2));
        eq.substitute('x', state.x.toFixed(2));
        eq.substitute('out', output.x.toFixed(2));
        eqY.substitute('b', state.b.toFixed(2));
        eqY.substitute('y', state.y.toFixed(2));
        eqY.substitute('out', output.y.toFixed(2));
        view.element.dataset.output = JSON.stringify(output);
      },
    };
  }
  const layout = composition(book.stage, draw, () => controller.update());
  const script = {
    duration: 18,
    cues: {
      stretch: { start: 2, end: 5 },
      flatten: { start: 7, end: 10 },
      reflect: { start: 12, end: 16 },
    },
    segments: [
      { id: 'start', start: 0, end: 2, text: 'Исходный вектор показан синим.' },
      {
        id: 'stretch',
        start: 2,
        end: 7,
        text: 'Первый коэффициент растягивает горизонтальную компоненту.',
      },
      {
        id: 'flatten',
        start: 7,
        end: 12,
        text: 'Второй коэффициент меняет вертикальную компоненту.',
      },
      { id: 'reflect', start: 12, end: 18, text: 'Отрицательный коэффициент отражает компоненту.' },
    ],
  };
  const controller = story({
    script,
    stateAt: (frame) => ({
      x: 1.5,
      y: 1,
      a: frame.has('reflect')
        ? interpolate(1.8, -1, frame.reveal('reflect'))
        : interpolate(1, 1.8, frame.reveal('stretch')),
      b: interpolate(1, 0.5, frame.reveal('flatten')),
    }),
    render: (state) => layout.current.render(state),
  });
  const fields = (
    [
      { key: 'a', label: 'Масштаб x' },
      { key: 'b', label: 'Масштаб y' },
      { key: 'x', label: 'Вход x' },
      { key: 'y', label: 'Вход y' },
    ] as const
  ).map(({ key, label }) => ({
    key,
    control: range({
      label,
      min: -1.8,
      max: 1.8,
      step: 0.05,
      value: controller.values[key],
      format: (value) => value.toFixed(2),
      onInput: (value) => controller.explore({ ...controller.values, [key]: value }),
    }),
  }));
  for (const { control } of fields) book.parameters.append(control.element);
  const unsubscribe = controller.subscribe((_, state) => {
    for (const { key, control } of fields) control.set(state[key]);
  });
  book.attach(controller);
  return {
    duration: 18,
    checkpoints: [0, 5, 10, 16],
    seek: controller.seek,
    pause: controller.player.pause,
    setTheme: book.theme,
    setReduced: controller.setReduced,
    svg: () => layout.current.view.element,
    snapshot: () => ({ input: controller.values, output: transform(controller.values) }),
    dispose() {
      unsubscribe();
      fields.forEach(({ control }) => control.dispose());
      book.dispose();
      layout.dispose();
    },
  };
}
