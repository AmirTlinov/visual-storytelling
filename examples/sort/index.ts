import {
  notebook,
  surface,
  composition,
  object,
  lettering,
  token,
  swap,
  story,
  range,
} from '@visual-storytelling/core';
import { comparisons, sortingAt } from './model';
import type { Example } from '../types';
import type { Point } from '@visual-storytelling/core';

export function mount(parent: HTMLElement): Example {
  const values = [5, 2, 4, 1, 3],
    sequence = comparisons(values),
    duration = sequence.steps.length * 3 + 2;
  const book = notebook(parent, {
    title: 'Как числа находят своё место',
    subtitle: 'Сравниваем только двух соседей.',
  });
  function draw(width: number) {
    const view = surface(book.stage, {
      id: 'sort',
      width,
      height: 350,
      title: 'Пузырьковая сортировка',
      description:
        'Соседние числа сравниваются и меняются местами. Объекты сохраняются между шагами.',
    });
    const gap = Math.min(108, (width - 64) / 5),
      left = width / 2 - 2 * gap,
      y = 135,
      size = Math.min(62, gap * 0.73);
    const items = values.map((value, i) => token(view, `item-${i}`, value, { size }));
    const note = object(view.layer, 'comparison', 'ochre');
    const text = lettering(note.content, '', { size: width < 440 ? 24 : 30 });
    const arrow = object(view.layer, 'comparison-mark', 'ochre');
    const bracket = view.pen.path(
      arrow.content,
      'pair-bracket',
      `M${-gap / 2 - 20} 0 q0 9 9 9 H${gap / 2 + 11} q9 0 9 -9`,
    );
    const end = object(view.layer, 'sorted', 'green');
    end.at(width / 2, 285);
    lettering(end.content, 'По возрастанию', { size: 29 });
    const resultLine = view.pen.line(end.content, 'sorted:underline', [-105, 13], [105, 13]);
    return {
      view,
      dispose: view.dispose,
      render(state: ReturnType<typeof sortingAt>) {
        const positions: Point[] = state.order.map((_, i) => [left + i * gap, y]);
        if (!state.done && state.exchange) {
          const pair = swap(
            positions[state.index]!,
            positions[state.index + 1]!,
            state.progress,
            size * 0.85,
          );
          positions[state.index] = pair[0];
          positions[state.index + 1] = pair[1];
        }
        state.order.forEach((item, index) => {
          const mark = items[Number(item.id.split('-')[1])]!;
          mark.at(...positions[index]!);
          mark.pigment(
            state.done || index >= 5 - state.settled
              ? 'green'
              : index === state.index
                ? 'ochre'
                : index === state.index + 1
                  ? 'blue'
                  : 'ink',
          );
        });
        const x = left + (state.index + 0.5) * gap;
        note.at(Math.max(90, Math.min(width - 90, x)), 55);
        arrow.at(x, y + size * 0.6 + 48);
        text.text(
          `${state.order[state.index]!.value} ${state.exchange ? '>' : '≤'} ${state.order[state.index + 1]!.value}`,
        );
        note.show(!state.done);
        arrow.show(!state.done);
        bracket.reveal(1);
        end.show(state.done);
        resultLine.reveal(1);
        view.element.dataset.order = state.order.map((item) => item.value).join(',');
        view.element.dataset.step = String(state.step);
      },
    };
  }
  const layout = composition(book.stage, draw, () => controller.update());
  const script = {
    duration,
    cues: { start: { start: 0, end: 1 } },
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
    format: (value) => `${value} / ${sequence.steps.length}`,
    onInput: (value) => controller.explore(sortingAt(sequence, value * 3)),
  });
  const unsubscribe = controller.subscribe((_, state) =>
    step.set(state.done ? sequence.steps.length : state.step),
  );
  book.parameters.append(step.element);
  book.attach(controller);
  return {
    duration,
    checkpoints: [0.8, 1.7, 5, 15, duration],
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
