import { object, lettering } from '@visual-storytelling/core/ink';
import { plot, formula } from '@visual-storytelling/core/recipes';
import { inkButton, svgButton } from '@visual-storytelling/core/controls';
import { placeLabels } from '@visual-storytelling/core';
import { format, trial } from './model.js';

/** The point, measured interval and prediction all live in the plot's coordinates. */
export function distanceDrawing(view, width, height, speed, actions) {
  view.resize(width, height);
  const drawing = object(view.layer, 'motion-explanation');
  const local = { ...view, layer: drawing.content };
  const labels = [],
    controls = [];
  const write = (parent, text, options) => {
    const label = lettering(parent, text, options);
    labels.push(label);
    return label;
  };
  const chart = plot(local, 'distance-plot', {
    x: 76,
    y: 66,
    width: width - 204,
    height: height - 166,
    xDomain: [0, 10],
    yDomain: [0, 40],
    tickSize: 24,
    xTicks: [0, 2, 4, 6, 8, 10].map((value) => ({ value, label: String(value) })),
    yTicks: [10, 20, 30, 40].map((value) => ({ value, label: String(value) })),
  });
  write(drawing.content, 'Путь, м', {
    x: 12,
    y: 34,
    size: 28,
    anchor: 'start',
    handwriting: 'note',
  });
  write(drawing.content, 'Время, с', {
    x: width - 14,
    y: height - 25,
    size: 28,
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
  const projection = object(drawing.content, 'projection', 'muted');
  const guides = view.pen.polyline(
    projection.content,
    'reading-guides',
    [
      [76, 66],
      [76, 66],
    ],
    { width: 1 },
  );
  for (const path of guides.element.querySelectorAll('path'))
    path.setAttribute('stroke-dasharray', '4 6');
  const value = object(drawing.content, 'distance-value', 'blue');
  const label = write(value.content, '', { size: 32, anchor: 'start', handwriting: 'heading' });
  const half = object(drawing.content, 'comparison-value', 'red');
  const halfLabel = write(half.content, '', { size: 28, anchor: 'start' });
  const ratio = formula(
    drawing.content,
    'speed-ratio',
    [
      { id: 'rise', text: '', pigment: 'blue' },
      { id: 'divide', text: '/' },
      { id: 'run', text: '', pigment: 'blue' },
      { id: 'equals', text: '=' },
      { id: 'speed', text: '', pigment: 'blue' },
    ],
    32,
  );
  const ratioGuide = view.pen.arrow(drawing.content, 'ratio-leader', [200, 78], [260, 115], {
    width: 1.3,
  });
  const rise = chart.interval('slope', {
    from: [0, 0],
    to: [3, speed * 3],
    pigment: 'blue',
    size: 28,
    formatX: (value) => `${format(value)} с`,
    formatY: (value) => `${format(value)} м`,
  });
  const detail = svgButton(value.content, {
    label: 'Измерить наклон у точки',
    x: 0,
    y: 0,
    width: 50,
    height: 50,
    pressed: false,
    onPress: actions.detail,
  });
  controls.push(detail);
  const prediction = object(drawing.content, 'prediction', 'red');
  const futureX = chart.point(trial.start + trial.seconds, 0)[0];
  const futureLine = view.pen.line(
    prediction.content,
    'future-time',
    [futureX, 110],
    [futureX, chart.point(trial.start + trial.seconds, 0)[1]],
    { width: 1 },
  );
  for (const p of futureLine.element.querySelectorAll('path'))
    p.setAttribute('stroke-dasharray', '4 7');
  const futureLabel = write(prediction.content, `Через ${trial.seconds} с`, {
    x: futureX,
    y: 88,
    size: 28,
    handwriting: 'note',
  });
  const candidates = trial.choices.map((guess) => {
    const mark = object(prediction.content, `prediction-${guess}`, 'muted');
    mark.at(...chart.point(trial.start + trial.seconds, guess));
    view.pen.ellipse(mark.content, `choice-${guess}`, 0, 0, 10, 10, { width: 1.8, fill: 'marker' });
    const label = write(mark.content, `${guess} м`, { x: 20, y: 9, size: 28, anchor: 'start' });
    const button = svgButton(mark.content, {
      x: -20,
      y: -21,
      width: 116,
      height: 42,
      label: `Прогноз: ${guess} м`,
      pressed: false,
      onPress: () => actions.choose(guess),
    });
    controls.push(button);
    return { guess, mark, button, label };
  });
  const run = inkButton(local, 'advance-motion', `Пройти +${trial.seconds} с`, {
    label: `Пройти ещё ${trial.seconds} секунды`,
    onPress: actions.run,
    width: 228,
    height: 44,
    size: 28,
    pigment: 'blue',
    disabled: true,
  });
  run.at(width * 0.6, height - 38);
  controls.push(run);
  const practice = inkButton(local, 'try-motion', `+${trial.seconds} с → ? м`, {
    label: 'Отметить будущую точку',
    onPress: actions.practice,
    width: 228,
    height: 44,
    size: 28,
    pigment: 'blue',
  });
  practice.at(216, height - 38);
  controls.push(practice);
  const assessment = object(drawing.content, 'prediction-result', 'red');
  const assessmentText = write(assessment.content, '', {
    size: 27,
    anchor: 'start',
    handwriting: 'note',
  });
  assessment.element.setAttribute('role', 'status');
  assessment.element.setAttribute('aria-live', 'polite');
  assessment.element.setAttribute('tabindex', '-1');
  assessment.element.style.outline = 'none';
  let current;
  value.describe({
    label: 'Пройденный путь: измерить наклон',
    value: () => current?.distance,
    unit: 'м',
    provenance: () => current && { time: current.time, speed: current.speed, rule: 'time × speed' },
  });
  return {
    render(model) {
      const focusResult =
        model.checked && !current?.checked && document.activeElement === run.control;
      current = model;
      trace.at(model.time, model.distance);
      trace.showAhead(!model.practice || model.checked);
      comparison.at(model.time, model.comparison ?? 0);
      comparison.show(model.comparison !== null);
      const p = chart.point(model.time, model.distance),
        origin = chart.point(0, 0);
      guides.update([[origin[0], p[1]], p, [p[0], origin[1]]]);
      label.text(`${format(model.distance)} м`);
      const q = chart.point(model.time, model.comparison ?? 0);
      half.show(model.comparison !== null);
      halfLabel.text(`${format(model.comparison ?? 0)} м`);
      const values = model.comparison === null ? [label] : [label, halfLabel];
      values.forEach((label) => label.at(0, 0));
      const metrics = values.map((label) => label.bounds);
      const positions = placeLabels(
        metrics.map((box, i) => ({
          ...box,
          x: (i ? q : p)[0] + 18,
          y: (i ? q[1] + 38 : p[1] - 20) + box.y,
        })),
        { x: 84, y: 28, width: width - 100, height: height - 152 },
      );
      values.forEach((label, i) =>
        label.at(positions[i].x - metrics[i].x, positions[i].y - metrics[i].y),
      );
      detail.bounds({
        x: label.bounds.x - 8,
        y: label.bounds.y - 8,
        width: label.bounds.width + 16,
        height: label.bounds.height + 16,
      });
      detail.update({ pressed: model.detail, disabled: model.practice && !model.checked });
      rise.at(
        [model.interval.start, model.interval.start * model.speed],
        [model.time, model.distance],
      );
      const measured = model.detail && model.time > 0;
      rise.show(measured);
      projection.show(!measured);
      ratio.show(measured);
      ratioGuide.element.style.display = measured ? '' : 'none';
      ratio.substitute('rise', `${format(model.interval.distance)} м`);
      ratio.substitute('run', `${format(model.interval.seconds)} с`);
      ratio.substitute('speed', `${format(model.speed)} м/с`);
      // The inscription points into the measured triangle, away from both traces.
      const a = chart.point(model.interval.start, model.interval.start * model.speed);
      const center = Math.max(
        140 + ratio.width / 2,
        Math.min((a[0] + p[0]) / 2, width - 280 - ratio.width / 2),
      );
      ratio.at(center, 35);
      ratioGuide.between([center, 52], [(a[0] + p[0]) / 2, (a[1] + p[1]) / 2 - 14]);
      prediction.show(model.practice);
      futureLabel.element.style.display = model.checked ? 'none' : '';
      for (const choice of candidates) {
        const selected = choice.guess === model.guess;
        choice.mark.pigment(selected ? 'red' : 'muted');
        choice.mark.show(!model.checked || selected);
        choice.label.element.style.display =
          model.checked && model.guess === model.distance ? 'none' : '';
        // Keep a missed prediction clear of the measured rise at the same time coordinate.
        choice.label.at(20, model.checked ? (choice.guess < model.distance ? 44 : -22) : 9);
        choice.button.update({ pressed: selected, disabled: model.checked });
      }
      run.element.style.display = model.practice && !model.checked ? '' : 'none';
      run.update({ disabled: model.guess < 0 || model.checked });
      practice.text(model.practice ? 'К графику' : `+${trial.seconds} с → ? м`);
      practice.update({
        label: model.practice ? 'Вернуться к графику' : 'Отметить будущую точку',
        pressed: model.practice,
      });
      assessment.show(model.practice && model.checked);
      if (model.practice && model.checked) {
        assessmentText.text(model.guess === model.distance ? '✓' : '');
        assessmentText.at(
          Math.min(width - 38, label.bounds.x + label.bounds.width + 12),
          label.bounds.y + label.bounds.height,
        );
        assessment.element.setAttribute(
          'aria-label',
          `Прогноз ${model.guess} м. Получилось ${format(model.distance)} м.`,
        );
      }
      if (focusResult) assessment.element.focus({ preventScroll: true });
    },
    dispose() {
      controls.forEach((control) => control.dispose());
      labels.forEach((label) => label.dispose());
      ratio.dispose();
      rise.dispose();
      chart.dispose();
      drawing.dispose();
    },
  };
}
