import {
  notebook,
  surface,
  composition,
  object,
  lettering,
  choice,
  story,
  pigments,
} from '@visual-storytelling/core';
import type { Pigment } from '@visual-storytelling/core';
import type { SceneHandle as Example } from '@visual-storytelling/core';

export function mount(parent: HTMLElement): Example {
  const book = notebook(parent, {
    title: 'Инструменты одного почерка',
    subtitle: 'Ручка, маркер и аккуратная штриховка.',
    parameters: [
      {
        key: 'progress',
        label: 'След инструмента',
        min: 0,
        max: 1,
        step: 0.01,
        value: 1,
        format: (value) => `${Math.round(Number(value) * 100)}%`,
      },
    ],
  });
  let pigment: Pigment = 'blue';
  function draw(width: number) {
    const columns = width < 540 ? 2 : 3,
      cellW = (width - 30) / columns;
    const view = surface(book.stage, {
      id: 'materials',
      width,
      height: width < 540 ? 510 : 365,
      title: 'Материалы и палитра',
      description:
        'Одинаковая фигура в трёх материалах. Плотные чернила и прозрачный маркер используют один пигмент.',
    });
    const marks = (
      [
        { label: 'ручка', fill: 'none' },
        { label: 'маркер', fill: 'marker' },
        { label: 'штриховка', fill: 'hatch' },
      ] as const
    ).map((item, i) => {
      const mark = object(view.layer, `material-${i}`, pigment);
      mark.at(15 + ((i % columns) + 0.5) * cellW, 75 + Math.floor(i / columns) * 150);
      const shape = view.pen.rect(mark.content, `material-${i}:shape`, -48, -28, 96, 64, {
        fill: item.fill,
      });
      const label = lettering(mark.content, item.label, { y: 67, size: 22 });
      return { mark, shape, label };
    });
    const swatchY = width < 540 ? 370 : 222;
    (Object.keys(pigments) as Pigment[]).forEach((role, i) => {
      const mark = object(view.layer, `pigment-${role}`, role);
      mark.at(width / 2 + (i - 3) * Math.min(66, (width - 36) / 7), swatchY);
      view.pen.ellipse(mark.content, `${role}:swatch`, 0, 0, 13, 13, {
        fill: 'marker',
        width: 2.3,
      });
    });
    lettering(view.layer, 'Цвет следует смыслу', { x: width / 2, y: swatchY + 60, size: 26 });
    return {
      view,
      dispose: view.dispose,
      render(progress: number) {
        for (const { mark, shape, label } of marks) {
          mark.pigment(pigment);
          shape.reveal(progress);
          label.write(1);
        }
      },
    };
  }
  const layout = composition(book.stage, draw, () => controller.update());
  const controller = story({
    script: {
      duration: 5,
      cues: {
        draw: {
          start: 0.3,
          end: 4,
          action: 'Один контур последовательно раскрывается ручкой, маркером и штриховкой.',
        },
      },
    },
    stateAt: (frame) => ({ progress: frame.reveal('draw') }),
    render: (value) => layout.current.render(value.progress),
  });
  const colour = choice(
    'Пигмент',
    [
      { value: 'blue', label: 'Синий', pigment: 'blue' },
      { value: 'orange', label: 'Охра', pigment: 'orange' },
      { value: 'purple', label: 'Фиолетовый', pigment: 'purple' },
      { value: 'green', label: 'Зелёный', pigment: 'green' },
    ] as const,
    'blue',
    (value) => {
      pigment = value;
      controller.update();
    },
  );
  book.parameters.append(colour.element);
  book.onDispose(colour.dispose);
  book.onDispose(layout.dispose);
  return book.attach(controller).extend({
    checkpoints: [1, 2, 4],
    setTheme: book.theme,
    svg: () => layout.current.view.element,
    snapshot: () => ({ progress: controller.values.progress, pigment }),
  });
}
