import { object, lettering } from '@visual-storytelling/core/ink';
import { plot } from '@visual-storytelling/core/recipes';
import { placeLabels } from '@visual-storytelling/core';
import { format } from './model.js';

/** Measured projections connect the readout to the same point that the model moves. */
export function distanceDrawing(view, width, speed) {
  const height = width < 440 ? 360 : 400;
  view.resize(width, height);
  const drawing = object(view.layer, 'motion-explanation');
  const chart = plot({ ...view, layer: drawing.content }, 'distance-plot', {
    x: 46,
    y: 68,
    width: width - 94,
    height: height - 134,
    xDomain: [0, 10],
    yDomain: [0, 40],
    xTicks: [0, 2, 4, 6, 8, 10].map((value) => ({ value, label: String(value) })),
    yTicks: [10, 20, 30, 40].map((value) => ({ value, label: String(value) })),
  });
  lettering(drawing.content, 'Путь, м', {
    x: 8,
    y: 26,
    size: 22,
    anchor: 'start',
    handwriting: 'note',
  });
  lettering(drawing.content, 'Время, с', {
    x: width - 24,
    y: height - 15,
    size: 22,
    anchor: 'end',
    handwriting: 'note',
  });
  const samples = [
    [0, 0],
    [10, speed * 10],
  ];
  const trace = chart.trace('speed', samples, 'blue');
  const comparison = chart.trace(
    'half-speed',
    samples.map(([x, y]) => [x, y / 2]),
    'red',
  );
  trace.element.setAttribute('aria-label', 'Исходная скорость');
  comparison.element.setAttribute('aria-label', 'Половина скорости');
  const projection = object(drawing.content, 'projection');
  projection.element.style.color = 'var(--ve-muted)';
  const guides = view.pen.polyline(
    projection.content,
    'reading-guides',
    [
      [46, 68],
      [46, 68],
    ],
    { width: 1 },
  );
  for (const path of guides.element.querySelectorAll('path'))
    path.setAttribute('stroke-dasharray', '4 6');
  const value = object(drawing.content, 'distance-value', 'blue');
  const label = lettering(value.content, '', { size: 25, anchor: 'start', handwriting: 'heading' });
  const half = object(drawing.content, 'comparison-value', 'red');
  const halfLabel = lettering(half.content, '', { size: 21, anchor: 'start' });
  const rise = chart.interval('slope', {
    from: [0, 0],
    to: [3, speed * 3],
    pigment: 'blue',
    formatX: (value) => `${format(value)} с`,
    formatY: (value) => `${format(value)} м`,
  });
  let current;
  value.describe({
    label: 'Пройденный путь: раскрыть чтение точки',
    value: () => current?.distance,
    unit: 'м',
    provenance: () => current && { time: current.time, speed: current.speed, rule: 'time × speed' },
  });
  return {
    render(model) {
      current = model;
      trace.at(model.time, model.distance);
      comparison.at(model.time, model.comparison ?? 0);
      comparison.show(model.comparison !== null);
      const p = chart.point(model.time, model.distance),
        origin = chart.point(0, 0);
      guides.update([[origin[0], p[1]], p, [p[0], origin[1]]]);
      label.text(`${format(model.distance)} м`);
      const q = chart.point(model.time, model.comparison ?? 0);
      half.show(model.comparison !== null);
      halfLabel.text(`${format(model.comparison ?? 0)} м`);
      const labels = model.comparison === null ? [label] : [label, halfLabel];
      labels.forEach((label) => label.at(0, 0));
      const metrics = labels.map((label) => label.bounds);
      const positions = placeLabels(
        metrics.map((box, i) => ({
          ...box,
          x: (i ? q : p)[0] + 12,
          y: (i ? q[1] + 25 : p[1] - 14) + box.y,
        })),
        { x: 48, y: 36, width: width - 60, height: height - 114 },
      );
      labels.forEach((label, i) =>
        label.at(positions[i].x - metrics[i].x, positions[i].y - metrics[i].y),
      );
      rise.at(
        [model.interval.start, model.interval.start * model.speed],
        [model.time, model.distance],
      );
      rise.show(model.detail && model.time > 0);
      projection.show(!model.detail || model.time === 0);
    },
    dispose() {
      label.dispose();
      halfLabel.dispose();
      rise.dispose();
      chart.dispose();
      drawing.dispose();
    },
  };
}
