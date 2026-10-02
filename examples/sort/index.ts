import { notebook, composition, story, range } from '@visual-storytelling/core';
import { comparisons, sortingAt } from './model';
import { drawing } from './drawing';
import type { Example } from '../types';

export function mount(parent: HTMLElement): Example {
  const values = [5, 1, 4, 2, 3],
    sequence = comparisons(values),
    duration = sequence.steps.length * 3 + 2;
  const book = notebook(parent, {
    title: 'Пузырьковая сортировка',
    subtitle: 'Один проход ставит на место самое большое из оставшихся чисел.',
  });
  const layout = composition(
    book.stage,
    (width) => drawing(book.stage, width, values),
    () => controller.update(),
  );
  const script = {
    duration,
    cues: {},
    segments: sequence.steps.map((step, i) => ({
      id: `pair-${i}`,
      start: i * 3,
      end: i * 3 + 3,
      text: `${step.order[step.index]!.value} ${step.exchange ? 'больше' : 'не больше'} ${step.order[step.index + 1]!.value}. ${step.exchange ? 'Меняем соседей местами.' : 'Оставляем на своих местах.'}`,
    })),
  };
  const controller = story({
    script,
    stateAt: (frame) => sortingAt(sequence, frame.time, frame.reduced),
    render: (state) => layout.current.render(state),
  });
  const step = range({
    label: 'Шаг сравнения',
    min: 0,
    max: sequence.steps.length,
    step: 1,
    value: 0,
    format: (value) =>
      value === sequence.steps.length ? 'Готово' : `${value + 1} / ${sequence.steps.length}`,
    onInput: (value) => controller.explore(sortingAt(sequence, value * 3)),
  });
  const unsubscribe = controller.subscribe((_, state) =>
    step.set(state.done ? sequence.steps.length : state.step),
  );
  book.parameters.append(step.element);
  book.attach(controller);
  return {
    duration,
    checkpoints: [0.8, 1.7, 5, 11.6, 15, duration],
    seek: controller.seek,
    pause: controller.player.pause,
    setTheme: book.theme,
    setReduced: controller.setReduced,
    svg: () => layout.current.view.element,
    snapshot: () => controller.values,
    dispose() {
      unsubscribe();
      step.dispose();
      book.dispose();
      layout.dispose();
    },
  };
}
