import { notebook, composition, range, story, interpolate } from '@visual-storytelling/core';
import { transform } from './model';
import { drawing } from './drawing';
import type { Example } from '../types';

export function mount(parent: HTMLElement): Example {
  const book = notebook(parent, {
    title: 'Матрица меняет вектор',
    subtitle: 'Два коэффициента — два независимых масштаба.',
  });
  const layout = composition(
    book.stage,
    (width) => drawing(book.stage, width),
    () => controller.update(),
  );
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
        ? interpolate(1.8, -1, frame.progress('reflect'))
        : interpolate(1, 1.8, frame.progress('stretch')),
      b: interpolate(1, 0.5, frame.progress('flatten')),
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
