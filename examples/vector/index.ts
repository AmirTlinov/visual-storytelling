import { notebook, composition, story, interpolate } from '@visual-storytelling/core';
import { transform } from './model';
import { drawing } from './drawing';
import type { SceneHandle as Example } from '@visual-storytelling/core';

export function mount(parent: HTMLElement): Example {
  const book = notebook(parent, {
    title: 'Матрица меняет вектор',
    subtitle: 'Два коэффициента — два независимых масштаба.',
    parameters: [
      { key: 'a', label: 'Масштаб x' },
      { key: 'b', label: 'Масштаб y' },
      { key: 'x', label: 'Вход x' },
      { key: 'y', label: 'Вход y' },
    ].map((parameter) => ({
      ...parameter,
      min: -1.8,
      max: 1.8,
      step: 0.05,
      value: 1,
      format: (value) => Number(value).toFixed(2),
    })),
  });
  const layout = composition(
    book.stage,
    (width) => drawing(book.stage, width),
    () => controller.update(),
  );
  const script = {
    duration: 18,
    cues: {
      stretch: {
        start: 2,
        end: 5,
        action:
          'Коэффициент x растёт от 1 до 1,8; горизонтальная компонента и произведение меняются вместе.',
      },
      flatten: {
        start: 7,
        end: 10,
        action:
          'Коэффициент y уменьшается до 0,5; вертикальная компонента и произведение меняются вместе.',
      },
      reflect: {
        start: 12,
        end: 16,
        action:
          'Коэффициент x проходит через ноль до −1; горизонтальная компонента меняет направление.',
      },
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
    derive: (input) => ({ ...input, output: transform(input) }),
    render: (state) => layout.current.render(state),
  });
  book.onDispose(layout.dispose);
  return Object.assign(book.attach(controller), {
    checkpoints: [0, 5, 10, 16],
    setTheme: book.theme,
    svg: () => layout.current.view.element,
    snapshot: () => ({ input: controller.values, output: controller.state.output }),
  });
}
