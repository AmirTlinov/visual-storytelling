import { notebook, composition, range, story } from '@visual-storytelling/core';
import { oscillator } from './model';
import { drawing } from './drawing';
import type { Example } from '../types';

export function mount(parent: HTMLElement): Example {
  const book = notebook(parent, {
    title: 'Колебательный LC-контур',
    subtitle: 'Энергия переходит между двумя полями.',
  });
  const layout = composition(
    book.stage,
    (width) => drawing(book.stage, width),
    () => controller.update(),
  );
  const script = {
    duration: 8,
    cues: {},
    segments: [
      {
        id: 'electric',
        start: 0,
        end: 1,
        text: 'Заряд пластин создаёт электрическое поле. Конденсатор разряжается.',
      },
      {
        id: 'magnetic',
        start: 1,
        end: 2,
        text: 'Ток максимален. Энергия в магнитном поле катушки; ток продолжает заряжать пластины.',
      },
      {
        id: 'reverse',
        start: 2,
        end: 3,
        text: 'Знак заряда поменялся. Теперь ток нарастает в обратную сторону.',
      },
      {
        id: 'return',
        start: 3,
        end: 4,
        text: 'Магнитные полюса поменялись. Заряд возвращается к исходному состоянию.',
      },
      {
        id: 'repeat',
        start: 4,
        end: 8,
        text: 'Второй цикл. Две доли энергии в сумме всегда дают единицу.',
      },
    ],
  };
  const controller = story({
    script,
    stateAt: (frame) => oscillator(frame.time, 4),
    render: (state, frame) => layout.current.render(state, frame.reduced),
  });
  const phase = range({
    label: 'Фаза колебания',
    min: 0,
    max: 360,
    step: 1,
    value: 0,
    format: (value) => `${value}°`,
    onInput: (value) => controller.explore(oscillator((value / 360) * 4, 4)),
  });
  const unsubscribe = controller.subscribe((_, state) =>
    phase.set(((state.time / state.period) * 360) % 360),
  );
  book.parameters.append(phase.element);
  book.attach(controller);
  return {
    duration: 8,
    checkpoints: [0, 0.5, 1, 1.5, 2, 3, 4, 7.5],
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
