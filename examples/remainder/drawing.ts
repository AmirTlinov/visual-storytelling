import {
  surface,
  object,
  lettering,
  formula,
  regroup,
  type Point,
} from '@visual-storytelling/core';
import type { RemainderState } from './model';

export function drawing(parent: HTMLElement, width: number) {
  const columns = width < 480 ? 3 : 4,
    cell = Math.min(150, (width - 24) / columns);
  const left = (width - columns * cell) / 2,
    top = 68;
  const rows = Math.ceil(8 / columns),
    bottom = top + (rows - 1) * 98;
  const view = surface(parent, {
    id: 'remainder',
    width,
    height: bottom + 174,
    title: 'Откуда берётся остаток',
    description:
      '23 предмета образуют семь полных троек. Два остаются; пустое место показывает, какого предмета не хватает для ещё одной тройки.',
  });
  const initialColumns = width < 480 ? 6 : 8;
  const from: Point[] = Array.from({ length: 23 }, (_, i) => [
    width / 2 + ((i % initialColumns) - (initialColumns - 1) / 2) * 33,
    top + Math.floor(i / initialColumns) * 29,
  ]);
  const centers: Point[] = Array.from({ length: 8 }, (_, i) => [
    left + ((i % columns) + 0.5) * cell,
    top + Math.floor(i / columns) * 98,
  ]);
  const to: Point[] = from.map((_, i) => [
    centers[Math.floor(i / 3)]![0] + ((i % 3) - 1) * 23,
    centers[Math.floor(i / 3)]![1],
  ]);
  const groups = centers.slice(0, 7).map((point, i) => {
    const mark = object(view.layer, `group-${i}`, 'blue');
    mark.at(...point);
    const shape = view.pen.rect(mark.content, `group-${i}:shape`, -40, -24, 80, 48);
    return { mark, shape, label: lettering(mark.content, String(i + 1), { y: 48, size: 19 }) };
  });
  const dots = from.map((_, i) => {
    const mark = object(view.layer, `dot-${i}`, 'blue');
    const shape = view.pen.ellipse(mark.content, `dot-${i}:shape`, 0, 0, 8.5, 8.5, {
      fill: 'marker',
    });
    return { mark, shape };
  });
  const missing = object(view.layer, 'missing-third');
  missing.at(...to[22]!);
  missing.move(23, 0);
  const ghost = view.pen.ellipse(missing.content, 'missing-third:shape', 0, 0, 8.5, 8.5, {
    width: 1,
  });
  ghost.element.querySelectorAll('path').forEach((path) => {
    path.style.strokeDasharray = '2 4';
  });
  const hint = lettering(missing.content, 'не хватает', { x: 0, y: 58, size: 15 });
  const remainder = object(view.layer, 'remainder', 'ochre');
  remainder.at(centers[7]![0] - 11, centers[7]![1] + 36);
  const remText = lettering(remainder.content, '2 — остаток', { size: width < 480 ? 16 : 20 });
  const count = object(view.layer, 'total-objects', 'purple');
  const countText = lettering(count.content, '23 предмета', {
    x: width / 2,
    y: bottom + 113,
    size: 27,
  });
  const groupSize = object(view.layer, 'group-size', 'blue');
  const sizeText = lettering(groupSize.content, 'по 3', {
    x: centers[0]![0],
    y: top - 38,
    size: 22,
  });
  const groupCount = object(view.layer, 'group-count', 'blue');
  const groupCountText = lettering(groupCount.content, '7 полных групп', {
    x: width / 2,
    y: bottom + 113,
    size: 26,
  });
  const product = formula(
    view.layer,
    'product',
    [
      { id: 'groups', text: 7, pigment: 'blue' },
      { id: 'times', text: '×' },
      { id: 'size', text: 3, pigment: 'blue' },
      { id: 'eq', text: '=' },
      { id: 'count', text: 21, pigment: 'blue' },
    ] as const,
    30,
  );
  product.at(width / 2, bottom + 113);
  const summary = formula(
    view.layer,
    'summary',
    [
      { id: 'whole', text: 23, pigment: 'purple' },
      { id: 'eq', text: '=' },
      { id: 'grouped', text: 21, pigment: 'blue' },
      { id: 'plus', text: '+' },
      { id: 'remainder', text: 2, pigment: 'ochre' },
    ] as const,
    32,
  );
  summary.at(width / 2, bottom + 113);
  const productIds = ['groups', 'times', 'size', 'eq', 'count'] as const;
  const summaryIds = ['whole', 'eq', 'grouped', 'plus', 'remainder'] as const;
  return {
    view,
    dispose: view.dispose,
    render(state: RemainderState) {
      const grouped = state.groups.some((p) => p > 0);
      dots.forEach(({ mark, shape }, i) => {
        const position = regroup([from[i]!], [to[i]!], state.groups[Math.floor(i / 3)]!)[0]!;
        mark.at(...position);
        mark.show(state.objects > 0);
        shape.reveal(state.objects);
        mark.pigment(i >= 21 && state.remainder > 0 ? 'ochre' : 'blue');
        mark.element.style.setProperty('--vs-wash-strength', state.first && i < 3 ? '34%' : '18%');
      });
      groups.forEach(({ mark, shape, label }, i) => {
        mark.show(grouped);
        shape.reveal(state.groups[i]!);
        label.write(state.groupCount);
      });
      count.show(state.groupCount === 0);
      countText.write(state.objects);
      groupSize.show(state.groupCount === 0);
      sizeText.write(state.groupSize);
      groupCount.show(!state.productVisible && state.summary[0] === 0);
      groupCountText.write(state.groupCount);
      product.show(state.productVisible);
      product.write((id) => state.product[productIds.indexOf(id)]!);
      summary.write((id) => state.summary[summaryIds.indexOf(id)]!);
      remainder.show(state.remainder > 0);
      remText.write(state.remainder);
      missing.show(state.missing);
      hint.write(Number(state.missing));
      view.element.dataset.objects = '23';
      view.element.dataset.missing = String(state.missing);
    },
  };
}
