import {
  notebook,
  surface,
  composition,
  object,
  lettering,
  formula,
  regroup,
  story,
  range,
} from '@visual-storytelling/core';
import type { Point } from '@visual-storytelling/core';
import type { Example } from '../types';

export function mount(parent: HTMLElement): Example {
  const book = notebook(parent, {
    title: 'Откуда берётся остаток',
    subtitle: '23 предмета. В каждой группе — по 3.',
  });
  function draw(width: number) {
    const columns = width < 480 ? 3 : 4,
      groupW = Math.min(132, (width - 32) / columns),
      left = (width - columns * groupW) / 2;
    const view = surface(book.stage, {
      id: 'remainder',
      width,
      height: 460,
      title: 'Деление с остатком',
      description: 'Двадцать три точки перегруппируются в семь троек. Два предмета остаются.',
    });
    const from: Point[] = Array.from({ length: 23 }, (_, i) => [
      width / 2 + ((i % 8) - 3.5) * Math.min(35, (width - 55) / 8),
      65 + Math.floor(i / 8) * 42,
    ]);
    const to: Point[] = Array.from({ length: 23 }, (_, i) => {
      const group = Math.floor(i / 3),
        col = group % columns,
        row = Math.floor(group / columns);
      return [left + col * groupW + groupW / 2 + ((i % 3) - 1) * 24, 56 + row * 98];
    });
    const dots = from.map((_, i) => {
      const mark = object(view.layer, `dot-${i}`, i >= 21 ? 'ochre' : 'blue');
      view.pen.ellipse(mark.content, `dot-${i}:shape`, 0, 0, 8, 8, { fill: 'marker' });
      return mark;
    });
    const groups = Array.from({ length: 7 }, (_, i) => {
      const mark = object(view.layer, `group-${i}`, 'blue');
      const center: Point = [
        left + (i % columns) * groupW + groupW / 2,
        56 + Math.floor(i / columns) * 98,
      ];
      mark.at(...center);
      const shape = view.pen.rect(mark.content, `group-${i}:shape`, -43, -23, 86, 48);
      const label = lettering(mark.content, String(i + 1), { y: 49, size: 23 });
      return { mark, shape, label };
    });
    const remainder = object(view.layer, 'remainder', 'ochre');
    remainder.at(to[21]![0] + 12, to[21]![1] + 46);
    const remLabel = lettering(remainder.content, 'осталось 2', { size: width < 480 ? 17 : 21 });
    const eq = formula(
      view.layer,
      'division',
      [
        { id: 'total', text: '23' },
        { id: 'equals', text: '=' },
        { id: 'groups', text: '7', pigment: 'blue' },
        { id: 'times', text: '×' },
        { id: 'size', text: '3', pigment: 'blue' },
        { id: 'plus', text: '+' },
        { id: 'remainder', text: '2', pigment: 'ochre' },
      ] as const,
      width < 480 ? 26 : 34,
    );
    eq.at(width / 2, 408);
    return {
      view,
      dispose: view.dispose,
      render(state: { progress: number; groups: number; answer: number }) {
        regroup(from, to, state.progress).forEach((point, i) => dots[i]!.at(...point));
        dots.forEach((dot, i) => dot.pigment(state.progress === 1 && i >= 21 ? 'ochre' : 'blue'));
        groups.forEach(({ mark, shape, label }, i) => {
          const p = Math.max(0, Math.min(1, state.groups - i));
          mark.show(p > 0);
          shape.reveal(p);
          label.write(p);
        });
        remainder.show(state.groups >= 7);
        remLabel.write(state.answer);
        eq.show(state.answer > 0);
        eq.write(state.answer);
        view.element.dataset.objects = String(dots.length);
      },
    };
  }
  const layout = composition(book.stage, draw, () => controller.update());
  const script = {
    duration: 17,
    cues: {
      group: { start: 1.5, end: 5 },
      count: { start: 5.5, end: 11 },
      answer: { start: 12, end: 14 },
    },
    segments: [
      { id: 'objects', start: 0, end: 1.5, text: 'Здесь двадцать три предмета.' },
      { id: 'group', start: 1.5, end: 5.5, text: 'Соберём предметы в тройки.' },
      { id: 'count', start: 5.5, end: 12, text: 'Получилось семь полных групп.' },
      {
        id: 'answer',
        start: 12,
        end: 17,
        text: 'Два предмета остались. Для ещё одной тройки их недостаточно.',
      },
    ],
  };
  const controller = story({
    script,
    stateAt: (frame) => ({
      progress: frame.reveal('group'),
      groups: frame.reveal('count') * 7,
      answer: frame.reveal('answer'),
    }),
    render: (state) => layout.current.render(state),
  });
  const parameter = range({
    label: 'Собрать в тройки',
    min: 0,
    max: 1,
    step: 0.01,
    value: 0,
    format: (value) => `${Math.round(value * 100)}%`,
    onInput: (value) =>
      controller.explore({
        progress: value,
        groups: value === 1 ? 7 : 0,
        answer: value === 1 ? 1 : 0,
      }),
  });
  const unsubscribe = controller.subscribe((_, state) => parameter.set(state.progress));
  book.parameters.append(parameter.element);
  book.attach(controller);
  return {
    duration: 17,
    checkpoints: [0, 3.5, 11, 14],
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
    },
  };
}
