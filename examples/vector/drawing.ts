import {
  surface,
  object,
  lettering,
  formula,
  matrix,
  vector,
  plot,
} from '@visual-storytelling/core';
import type { VectorState } from './model';

export function drawing(parent: HTMLElement) {
  const view = surface(parent, {
    id: 'vector',
    width: 1200,
    height: 420,
    title: 'Матрица меняет вектор',
    description:
      'Слева входной вектор, в центре два независимых масштаба, справа результат. Каждая строка вычисления умножает свою компоненту на соответствующий коэффициент.',
    grid: false,
  });
  const heading = (text: string, x: number, pigment: 'blue' | 'orange' | 'purple') => {
    const mark = object(view.layer, 'heading-' + pigment, pigment);
    lettering(mark.content, text, { x, y: 34, size: 34, handwriting: 'heading' });
  };
  heading('Вход x', 190, 'blue');
  heading('Масштабы A', 600, 'orange');
  heading('Выход Ax', 1010, 'purple');
  const coordinates = (id: string, x: number) => {
    const axes = plot(view, id, {
      x,
      y: 80,
      width: 320,
      height: 320,
      xDomain: [-4, 4],
      yDomain: [-4, 4],
      xTicks: [-2, 2].map((value) => ({ value, label: String(value) })),
      yTicks: [-2, 2].map((value) => ({ value, label: String(value) })),
      tickSize: 27,
      labelSize: 27,
      xLabel: 'x',
      yLabel: 'y',
    });
    return axes;
  };
  const before = coordinates('input-coordinates', 30),
    after = coordinates('output-coordinates', 850);
  const input = vector(view, 'input', 'blue', 2.8),
    output = vector(view, 'output', 'purple', 2.8);
  const inputParts = [vector(view, 'input-x', 'blue', 1.1), vector(view, 'input-y', 'blue', 1.1)];
  const outputParts = [
    vector(view, 'output-x', 'purple', 1.1),
    vector(view, 'output-y', 'purple', 1.1),
  ];
  [...inputParts, ...outputParts].forEach((part) => {
    part.element.style.opacity = '.45';
  });
  vector(view, 'input-to-transform', 'blue', 1.7).set([358, 128], [399, 128]);
  vector(view, 'transform-to-output', 'purple', 1.7).set([801, 128], [842, 128]);
  const a = matrix(view, 'matrix-A', {
    rows: 2,
    columns: 2,
    cellWidth: 70,
    cellHeight: 43,
    size: 28,
    minSize: 26,
    pigment: 'orange',
  });
  const x = matrix(view, 'vector-x', {
    rows: 2,
    columns: 1,
    cellWidth: 88,
    cellHeight: 43,
    size: 28,
    minSize: 26,
    pigment: 'blue',
  });
  const result = matrix(view, 'vector-result', {
    rows: 2,
    columns: 1,
    cellWidth: 88,
    cellHeight: 43,
    size: 28,
    minSize: 26,
    pigment: 'purple',
  });
  const start = 600 - (a.width + x.width + result.width + 72) / 2;
  a.at(start + a.width / 2, 128);
  x.at(start + a.width + 36 + x.width / 2, 128);
  result.at(start + a.width + x.width + 72 + result.width / 2, 128);
  lettering(view.layer, '×', { x: start + a.width + 18, y: 136, size: 28 });
  const matrixRelation = lettering(view.layer, '=', {
    x: start + a.width + 36 + x.width + 18,
    y: 136,
    size: 28,
  });
  const component = (id: string, label: string, y: number) => {
    lettering(view.layer, label, { x: 600, y: y - 39, size: 27 });
    const eq = formula(
      view.layer,
      id,
      [
        { id: 'coefficient', text: '1', pigment: 'orange' },
        { id: 'times', text: '×' },
        { id: 'input', text: '1', pigment: 'blue' },
        { id: 'eq', text: '=' },
        { id: 'output', text: '1', pigment: 'purple' },
      ] as const,
      32,
    );
    eq.at(600, y);
    return eq;
  };
  const horizontal = component('horizontal', 'по оси x', 277),
    vertical = component('vertical', 'по оси y', 376);
  const clean = (n: number) => Number(n.toFixed(2)).toString();
  // Equality describes the visible rounded operands, as well as the underlying model.
  const exact = (c: number, v: number, n: number) =>
    Math.abs(Number(clean(c)) * Number(clean(v)) - Number(clean(n))) < 1e-9;
  return {
    view,
    dispose: view.dispose,
    render(state: VectorState & { output: { x: number; y: number } }) {
      const out = state.output;
      input.set(before.point(0, 0), before.point(state.x, state.y));
      output.set(after.point(0, 0), after.point(out.x, out.y));
      for (const [parts, v, axes] of [
        [inputParts, state, before],
        [outputParts, out, after],
      ] as const) {
        parts[0]!.set(axes.point(0, 0), axes.point(v.x, 0));
        parts[1]!.set(axes.point(v.x, 0), axes.point(v.x, v.y));
      }
      a.set([
        [clean(state.a), '0'],
        ['0', clean(state.b)],
      ]);
      x.set([[clean(state.x)], [clean(state.y)]]);
      result.set([[clean(out.x)], [clean(out.y)]]);
      matrixRelation.text(
        exact(state.a, state.x, out.x) && exact(state.b, state.y, out.y) ? '=' : '≈',
      );
      for (const [eq, c, v, n] of [
        [horizontal, state.a, state.x, out.x],
        [vertical, state.b, state.y, out.y],
      ] as const) {
        eq.substitute('coefficient', clean(c));
        eq.substitute('input', clean(v));
        eq.substitute('output', clean(n));
        eq.substitute('eq', exact(c, v, n) ? '=' : '≈');
      }
      view.element.dataset.output = JSON.stringify(out);
    },
  };
}
