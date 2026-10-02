import {
  notebook,
  surface,
  composition,
  object,
  lettering,
  transfer,
  story,
  range,
} from '@visual-storytelling/core';
import type { Example } from '../types';

export function mount(parent: HTMLElement): Example {
  const book = notebook(parent, {
    title: 'Когда значение становится общим',
    subtitle: 'Получатель меняется в момент прибытия.',
  });
  function draw(width: number) {
    const vertical = width < 500,
      x1 = vertical ? width / 2 : width * 0.23,
      x2 = vertical ? width / 2 : width * 0.77,
      y1 = vertical ? 80 : 150,
      y2 = vertical ? 288 : 150;
    const view = surface(book.stage, {
      id: 'transfer',
      width,
      height: 410,
      title: 'Передача значения',
      description:
        'Значение 7 передаётся от источника к получателю. Пока пакет в пути, у получателя остаётся 2.',
    });
    const source = object(view.layer, 'source', 'blue');
    source.at(x1, y1);
    view.pen.rect(source.content, 'source:box', -58, -35, 116, 70, { fill: 'marker' });
    lettering(source.content, '7', { y: 11, size: 40 });
    lettering(source.content, 'источник', { y: -49, size: 22 });
    const target = object(view.layer, 'target', 'ochre');
    target.at(x2, y2);
    view.pen.rect(target.content, 'target:box', -58, -35, 116, 70, { fill: 'marker' });
    const value = lettering(target.content, '2', { y: 11, size: 40 });
    lettering(target.content, 'получатель', { y: 67, size: 22 });
    const route = transfer(view, 'value-transfer', {
      from: vertical ? [x1, y1 + 50] : [x1 + 74, y1],
      to: vertical ? [x2, y2 - 50] : [x2 - 74, y2],
      value: 7,
      pigment: 'purple',
    });
    const received = object(view.layer, 'received', 'green');
    received.at(vertical ? width / 2 : width * 0.77, vertical ? 382 : 264);
    lettering(received.content, 'получено', { size: 25 });
    return {
      view,
      dispose: view.dispose,
      render(progress: number, reduced: boolean) {
        const state = route.render(progress, reduced);
        value.text(state.arrived ? '7' : '2');
        target.pigment(state.arrived ? 'green' : 'ochre');
        received.show(state.arrived);
        view.element.dataset.received = String(state.arrived);
      },
    };
  }
  const layout = composition(book.stage, draw, () => controller.update());
  const script = {
    duration: 8,
    cues: { travel: { start: 1.5, end: 5.5 } },
    segments: [
      { id: 'source', start: 0, end: 1.5, text: 'Источник готов передать значение семь.' },
      { id: 'travel', start: 1.5, end: 5.5, text: 'Значение в пути. Получатель пока хранит два.' },
      { id: 'received', start: 5.5, end: 8, text: 'Передача завершена. Получатель хранит семь.' },
    ],
  };
  const controller = story({
    script,
    stateAt: (frame) => frame.progress('travel'),
    render: (value, frame) => layout.current.render(value, frame.reduced),
  });
  const progress = range({
    label: 'Путь значения',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0,
    format: (value) => `${Math.round(value * 100)}%`,
    onInput: (value) => controller.explore(value),
  });
  const unsubscribe = controller.subscribe((_, value) => progress.set(value));
  book.parameters.append(progress.element);
  book.attach(controller);
  return {
    duration: 8,
    checkpoints: [0, 3.5, 5.5],
    seek: controller.seek,
    pause: controller.player.pause,
    setTheme: book.theme,
    setReduced: controller.setReduced,
    svg: () => layout.current.view.element,
    snapshot: () => ({ progress: controller.values, received: controller.values >= 1 }),
    dispose() {
      unsubscribe();
      progress.dispose();
      book.dispose();
      layout.dispose();
    },
  };
}
