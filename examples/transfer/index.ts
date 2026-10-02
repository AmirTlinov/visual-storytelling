import { notebook, composition, story, range } from '@visual-storytelling/core';
import { drawing } from './drawing';
import { memoryAt, phases } from './model';
import type { Example } from '../types';

export function mount(parent: HTMLElement): Example {
  const book = notebook(parent, {
    title: 'Один буфер для CPU и GPU',
    subtitle: 'Чтение, вычисление и запись — по шагам.',
  });
  const layout = composition(
    book.stage,
    (width) => drawing(book.stage, width),
    () => controller.update(),
  );
  const controller = story({
    script: {
      duration: 24,
      cues: {},
      segments: phases.map(([id, text], i) => ({ id, text, start: i * 3, end: (i + 1) * 3 })),
    },
    stateAt: (frame) => memoryAt(frame.time),
    render: (state, frame) => layout.current.render(state, frame.reduced),
  });
  const step = range({
    label: 'Шаг',
    min: 0,
    max: 7,
    step: 1,
    value: 0,
    format: (value) => `${value + 1} / 8`,
    onInput: (value) => controller.explore(memoryAt(value * 3 + 2.5)),
  });
  const unsubscribe = controller.subscribe((_, state) => step.set(state.step));
  book.parameters.append(step.element);
  book.attach(controller);
  return {
    duration: 24,
    checkpoints: phases.map((_, i) => i * 3),
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
