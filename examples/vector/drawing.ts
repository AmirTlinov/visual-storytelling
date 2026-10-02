import {
  surface,
  object,
  lettering,
  formula,
  matrix,
  vector,
  plot,
} from '@visual-storytelling/core';
import { transform, type VectorState } from './model';

export function drawing(parent: HTMLElement, width: number) {
  const small = width < 480,
    unit = Math.min(42, (width - 72) / 8);
  const chartY = 30,
    chartHeight = 8 * unit,
    matrixY = chartY + chartHeight + 67;
  const view = surface(parent, {
    id: 'vector',
    width,
    height: matrixY + 149,
    title: 'Матрица меняет вектор',
    description:
      'Два коэффициента диагональной матрицы умножают соответствующие компоненты входного вектора. На координатной сетке показаны исходные и новые компоненты.',
    grid: { step: unit, x: width / 2, y: chartY + 4 * unit },
  });
  const axes = plot(view, 'coordinates', {
    x: width / 2 - 4 * unit,
    y: chartY,
    width: 8 * unit,
    height: chartHeight,
    xDomain: [-4, 4],
    yDomain: [-4, 4],
    xLabel: 'x',
    yLabel: 'y',
    yTicks: [-3, -2, -1, 1, 2, 3].map((value) => ({ value, label: String(value) })),
  });
  for (const x of [-3, -2, -1, 1, 2, 3]) {
    const p = axes.point(x, 0);
    lettering(view.layer, x, { x: p[0], y: p[1] + 20, size: 14 });
  }
  const input = vector(view, 'input', 'blue', 2.1),
    output = vector(view, 'output', 'purple', 2.3);
  const inputParts = [vector(view, 'input-x', 'blue', 0.8), vector(view, 'input-y', 'blue', 0.8)];
  const outputParts = [
    vector(view, 'output-x', 'purple', 0.8),
    vector(view, 'output-y', 'purple', 0.8),
  ];
  [...inputParts, ...outputParts].forEach((part) => {
    part.element.style.opacity = '.35';
  });
  const inputLabel = object(view.layer, 'input-label', 'blue'),
    outputLabel = object(view.layer, 'output-label', 'purple');
  lettering(inputLabel.content, 'x', { size: 22 });
  lettering(outputLabel.content, 'Ax', { size: 22 });
  const a = matrix(view, 'matrix-A', {
    rows: 2,
    columns: 2,
    cellWidth: small ? 44 : 53,
    cellHeight: 31,
    size: 21,
    pigment: 'ochre',
  });
  const x = matrix(view, 'vector-x', {
    rows: 2,
    columns: 1,
    cellWidth: small ? 50 : 58,
    cellHeight: 31,
    size: 21,
    pigment: 'blue',
  });
  const result = matrix(view, 'vector-result', {
    rows: 2,
    columns: 1,
    cellWidth: small ? 61 : 68,
    cellHeight: 31,
    size: 21,
    pigment: 'purple',
  });
  const start = width / 2 - (a.width + x.width + result.width + 72) / 2;
  a.at(start + a.width / 2, matrixY);
  x.at(start + a.width + 36 + x.width / 2, matrixY);
  result.at(start + a.width + x.width + 72 + result.width / 2, matrixY);
  lettering(view.layer, '×', { x: start + a.width + 18, y: matrixY + 6, size: 23 });
  lettering(view.layer, '=', { x: start + a.width + 36 + x.width + 18, y: matrixY + 6, size: 23 });
  const labels = [
    ['A', a, start + a.width / 2, 'ochre'],
    ['x', x, start + a.width + 36 + x.width / 2, 'blue'],
    ['Ax', result, start + a.width + x.width + 72 + result.width / 2, 'purple'],
  ] as const;
  for (const [name, , cx, pigment] of labels) {
    const label = object(view.layer, `label:${name}`, pigment);
    lettering(label.content, name, { x: cx, y: matrixY - 49, size: 21 });
  }
  const component = (id: string, y: number) => {
    const eq = formula(
      view.layer,
      id,
      [
        { id: 'coefficient', text: '1', pigment: 'ochre' },
        { id: 'times', text: '×' },
        { id: 'input', text: '1', pigment: 'blue' },
        { id: 'eq', text: '=' },
        { id: 'output', text: '1', pigment: 'purple' },
      ] as const,
      small ? 21 : 25,
    );
    eq.at(width / 2, y);
    return eq;
  };
  const horizontal = component('horizontal', matrixY + 86),
    vertical = component('vertical', matrixY + 126);
  const clean = (n: number) => Number(n.toFixed(2)).toString();
  return {
    view,
    dispose: view.dispose,
    render(state: VectorState) {
      const out = transform(state),
        origin = axes.point(0, 0);
      input.set(origin, axes.point(state.x, state.y));
      output.set(origin, axes.point(out.x, out.y));
      for (const [parts, v] of [
        [inputParts, state],
        [outputParts, out],
      ] as const) {
        parts[0]!.set(origin, axes.point(v.x, 0));
        parts[1]!.set(axes.point(v.x, 0), axes.point(v.x, v.y));
      }
      const pi = axes.point(state.x, state.y),
        po = axes.point(out.x, out.y);
      inputLabel.at(pi[0] - 14, pi[1] + 26);
      outputLabel.at(po[0] + 17, po[1] - 14);
      a.set([
        [clean(state.a), '0'],
        ['0', clean(state.b)],
      ]);
      x.set([[clean(state.x)], [clean(state.y)]]);
      result.set([[clean(out.x)], [clean(out.y)]]);
      for (const [eq, c, v, n] of [
        [horizontal, state.a, state.x, out.x],
        [vertical, state.b, state.y, out.y],
      ] as const) {
        eq.substitute('coefficient', clean(c));
        eq.substitute('input', clean(v));
        eq.substitute('output', clean(n));
      }
      view.element.dataset.output = JSON.stringify(out);
    },
  };
}
