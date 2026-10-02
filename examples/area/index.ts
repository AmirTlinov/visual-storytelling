import { notebook, story, composition, choice } from '@visual-storytelling/core';
import narration from './narration.json';
import { areaAt } from './model';
import { drawing } from './drawing';
import type { Example } from '../types';
import audioURL from './voice.m4a?url';

export function mount(parent: HTMLElement): Example {
  const book = notebook(parent, {
    title: 'Почему 4 × 5 = 20?',
    subtitle: 'Сначала измерим. Затем посчитаем.',
  });
  let formulas = false;
  const layout = composition(
    book.stage,
    (width) => drawing(book.stage, width),
    () => controller.update(),
  );
  const audio = new Audio(audioURL);
  audio.preload = 'metadata';
  const controller = story({
    script: narration,
    audio,
    stateAt: areaAt,
    render: (state, frame) => layout.current.render(state, frame, formulas),
  });
  const mode = choice(
    'Представление',
    [
      { value: 'numbers', label: 'Числа' },
      { value: 'formulas', label: 'Формулы' },
    ] as const,
    'numbers',
    (value) => {
      formulas = value === 'formulas';
      controller.update();
    },
  );
  book.parameters.append(mode.element);
  book.attach(controller);
  return {
    duration: narration.duration,
    checkpoints: [4.3, 6.2, 18.4, 25.7, 36.5, 42.2, 48.2, 58.1],
    audioURL,
    seek: controller.seek,
    pause: controller.player.pause,
    setTheme: book.theme,
    setReduced: controller.setReduced,
    svg: () => layout.current.view.element,
    snapshot: () => ({ time: controller.player.state.time, ...controller.values }),
    dispose() {
      mode.dispose();
      book.dispose();
      layout.dispose();
      audio.removeAttribute('src');
      audio.load();
    },
  };
}
