import {
  surface,
  object,
  lettering,
  token,
  swap,
  formula,
  type Point,
} from '@visual-storytelling/core';
import type { sortingAt } from './model';

export function drawing(parent: HTMLElement, width: number, values: readonly number[]) {
  const small = width < 480,
    gap = Math.min(110, (width - 24) / values.length);
  const left = width / 2 - ((values.length - 1) * gap) / 2,
    y = 152;
  const size = Math.min(64, gap * 0.83),
    view = surface(parent, {
      id: 'sort',
      width,
      height: 354,
      title: 'Пузырьковая сортировка',
      description:
        'Сравнение соседей, обмен, проход вправо и растущий отсортированный хвост. Те же числа перемещаются по дугам.',
    });
  const direction = object(view.layer, 'larger-right');
  lettering(direction.content, 'Большее — вправо', { x: width / 2, y: 35, size: small ? 22 : 26 });
  view.pen.arrow(
    direction.content,
    'larger-right:arrow',
    [left, 57],
    [left + (values.length - 1) * gap, 57],
    { width: 1.2 },
  );
  const items = values.map((value, i) => token(view, `item-${i}`, value, { size }));
  const comparison = formula(
    view.layer,
    'comparison',
    [
      { id: 'left', text: values[0]!, pigment: 'ochre' },
      { id: 'relation', text: '>' },
      { id: 'right', text: values[1]!, pigment: 'blue' },
    ] as const,
    25,
  );
  const pair = object(view.layer, 'pair', 'purple');
  view.pen.path(pair.content, 'pair:brace', `M${-gap + 4} 0 q0 8 8 8 H${gap - 12} q8 0 8 -8`, {
    width: 1.3,
  });
  const action = lettering(pair.content, 'обмен', { y: 35, size: 18 });
  const tails = Array.from({ length: values.length }, (_, i) => {
    const mark = object(view.layer, `settled:${i}`, 'green');
    const x1 = left + i * gap - size / 2,
      x2 = left + (values.length - 1) * gap + size / 2;
    view.pen.path(mark.content, `settled:${i}:brace`, `M${x1} 285 q0 8 8 8 H${x2 - 8} q8 0 8 -8`, {
      width: 1.2,
    });
    lettering(mark.content, i === 0 ? 'всё на месте' : 'на месте', {
      x: (x1 + x2) / 2,
      y: 318,
      size: 17,
    });
    return mark;
  });
  const pass = lettering(view.layer, '', { x: width / 2, y: 344, size: small ? 15 : 18 });
  const done = object(view.layer, 'sorted', 'green');
  lettering(done.content, 'По возрастанию', { x: width / 2, y: 246, size: 27 });
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
          size / 2 + 6,
        );
        positions[state.index] = pair[0];
        positions[state.index + 1] = pair[1];
      }
      const settled = state.done ? values.length : state.settled + Number(state.returning);
      state.order.forEach((item, index) => {
        const mark = items[Number(item.id.split('-')[1])]!;
        const active = !state.done && (index === state.index || index === state.index + 1);
        mark.at(...positions[index]!);
        mark.highlight(active || index >= values.length - settled);
        mark.pigment(
          index >= values.length - settled
            ? 'green'
            : active
              ? index === state.index
                ? 'ochre'
                : 'blue'
              : 'ink',
        );
      });
      const center = left + (state.index + 0.5) * gap;
      comparison.at(center, 100);
      comparison.show(!state.done && state.progress === 0);
      comparison.substitute('left', state.order[state.index]!.value);
      comparison.substitute('relation', state.exchange ? '>' : '≤');
      comparison.substitute('right', state.order[state.index + 1]!.value);
      pair.at(center, y + size / 2 + 42);
      pair.show(!state.done);
      action.text(
        state.returning ? 'снова слева' : state.exchange ? 'меняем местами' : 'оставляем',
      );
      tails.forEach((tail, i) => tail.show(settled > 0 && i === values.length - settled));
      done.show(state.done);
      pass.text(`Проход ${state.pass} · сравнений ${state.comparisons} · обменов ${state.swaps}`);
      view.element.dataset.order = state.order.map((item) => item.value).join(',');
      view.element.dataset.pass = String(state.pass);
      view.element.dataset.swaps = String(state.swaps);
    },
  };
}
