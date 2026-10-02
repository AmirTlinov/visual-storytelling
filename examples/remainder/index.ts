import { notebook, composition, range, story } from '@visual-storytelling/core';
import { remainderAt } from './model';
import { drawing } from './drawing';
import narration from './narration.json';
import audioURL from './voice.m4a?url';
import type { Example } from '../types';

export function mount(parent: HTMLElement): Example {
  const book = notebook(parent, {
    title: 'Откуда берётся остаток',
    subtitle: '23 предмета превращаются в группы по три.',
  });
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
    stateAt: remainderAt,
    render: (state) => layout.current.render(state),
  });
  const parameter = range({
    label: 'Собрать в тройки',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0,
    format: (value) => `${Math.round(value * 100)}%`,
    onInput: (value) => {
      const c = narration.cues.group_action;
      controller.explore(
        remainderAt(
          controller.sheet.at(
            value === 1 ? narration.duration : c.start + value * (c.end - c.start),
          ),
        ),
      );
    },
  });
  const unsubscribe = controller.subscribe((_, state) => parameter.set(state.progress));
  book.parameters.append(parameter.element);
  book.attach(controller);
  return {
    duration: narration.duration,
    checkpoints: [5.8, 8, 11, 14, 16.9, 20.8, 26.5],
    audioURL,
    seek: controller.seek,
    pause: controller.player.pause,
    setTheme: book.theme,
    setReduced: controller.setReduced,
    svg: () => layout.current.view.element,
    snapshot: () => controller.values,
    dispose() {
      unsubscribe();
      parameter.dispose();
      book.dispose();
      layout.dispose();
      audio.removeAttribute('src');
      audio.load();
    },
  };
}
