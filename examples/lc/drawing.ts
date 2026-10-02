import { surface, object, lettering, portion, symbol, plot } from '@visual-storytelling/core';
import { circuit } from './circuit';
import { oscillator, type OscillatorState } from './model';

export function drawing(parent: HTMLElement, width: number) {
  const compact = width < 520,
    bottom = compact ? 308 : 350;
  const energyY = bottom + 81,
    side = compact ? 43 : 52;
  const totalY = energyY + side + 97,
    graphY = totalY + 122,
    graphHeight = compact ? 118 : 135;
  const view = surface(parent, {
    id: 'lc',
    width,
    height: graphY + graphHeight + 83,
    title: 'Колебательный LC-контур',
    description:
      'Заряды пластин, электрическое поле, дрейф электронов, ток, магнитные полюса, две доли энергии и графики напряжения и тока следуют одной фазе.',
  });
  const body = circuit(view, width);
  const { left, right } = body.geometry;
  const wc = portion(view, 'energy-C', { x: left, y: energyY, size: side, pigment: 'ochre' });
  const wl = portion(view, 'energy-L', { x: right, y: energyY, size: side, pigment: 'purple' });
  symbol(view.layer, 'W-C', 'W', { sub: 'C', x: left, y: energyY - 15, pigment: 'ochre' });
  symbol(view.layer, 'W-L', 'W', { sub: 'L', x: right, y: energyY - 15, pigment: 'purple' });
  const electric = object(view.layer, 'electric-energy-label', 'ochre'),
    magnetic = object(view.layer, 'magnetic-energy-label', 'purple');
  const valueC = lettering(electric.content, '1.00', {
    x: left,
    y: energyY + side + 24,
    size: 20,
    tabular: true,
  });
  const valueL = lettering(magnetic.content, '0.00', {
    x: right,
    y: energyY + side + 24,
    size: 20,
    tabular: true,
  });
  for (const [parent, x, words] of [
    [electric.content, left, ['электрическое', 'поле']],
    [magnetic.content, right, ['магнитное', 'поле']],
  ] as const)
    words.forEach((word, i) =>
      lettering(parent, word, { x, y: energyY + side + 47 + i * 20, size: compact ? 16 : 20 }),
    );
  const exchange = object(view.layer, 'energy-transfer');
  exchange.at(width / 2, energyY + side / 2);
  const half = (right - left - side - 30) / 2;
  view.pen.arrow(exchange.content, 'energy-transfer:arrow', [-half, 0], [half, 0], { width: 1.2 });
  // Subscripts share their symbols' position and colour through symbol().
  const totalC = symbol(view.layer, 'conserved-C', 'W', {
    sub: 'C',
    x: width / 2 - 72,
    y: totalY,
    pigment: 'ochre',
    size: 26,
  });
  const totalL = symbol(view.layer, 'conserved-L', 'W', {
    sub: 'L',
    x: width / 2 + 4,
    y: totalY,
    pigment: 'purple',
    size: 26,
  });
  lettering(view.layer, '+', { x: width / 2 - 34, y: totalY, size: 26 });
  lettering(view.layer, '=', { x: width / 2 + 40, y: totalY, size: 26 });
  const one = object(view.layer, 'conserved-one', 'green');
  lettering(one.content, '1', { x: width / 2 + 74, y: totalY, size: 26 });
  totalC.element.dataset.quantity = 'electric';
  totalL.element.dataset.quantity = 'magnetic';
  const equations = object(view.layer, 'oscillation-equation');
  equations.at(width / 2, totalY + 44);
  lettering(equations.content, 'd²v', { x: -57, y: -5, size: 21 });
  lettering(equations.content, 'dt²', { x: -57, y: 26, size: 21 });
  view.pen.line(equations.content, 'derivative-fraction', [-84, 3], [-30, 3], { width: 1.1 });
  lettering(equations.content, '+', { x: -10, y: 10, size: 25 });
  lettering(equations.content, 'v', { x: 29, y: -5, size: 21 });
  lettering(equations.content, 'LC', { x: 29, y: 26, size: 21 });
  view.pen.line(equations.content, 'voltage-fraction', [10, 3], [48, 3], { width: 1.1 });
  lettering(equations.content, '= 0', { x: 83, y: 10, size: 25 });
  const voltageLabel = object(view.layer, 'voltage-label', 'ochre'),
    currentLabel = object(view.layer, 'current-label', 'blue');
  lettering(voltageLabel.content, 'v — напряжение', {
    x: width * 0.28,
    y: graphY - 18,
    size: compact ? 16 : 20,
  });
  lettering(currentLabel.content, 'i — ток', {
    x: width * 0.75,
    y: graphY - 18,
    size: compact ? 16 : 20,
  });
  const graph = plot(view, 'waveforms', {
    x: 31,
    y: graphY,
    width: width - 64,
    height: graphHeight,
    xDomain: [0, 8],
    yDomain: [-1.2, 1.2],
    xLabel: 't',
    xTicks: [
      { value: 0, label: '0' },
      { value: 4, label: 'T' },
      { value: 8, label: '2T' },
    ],
  });
  const times = Array.from({ length: 241 }, (_, i) => i / 30);
  const voltage = graph.trace(
    'voltage',
    times.map((t) => [t, oscillator(t, 4).charge]),
    'ochre',
  );
  const current = graph.trace(
    'current',
    times.map((t) => [t, oscillator(t, 4).current]),
    'blue',
  );
  const cursor = object(view.layer, 'phase-cursor');
  view.pen.line(cursor.content, 'phase-cursor:line', [0, graphY], [0, graphY + graphHeight], {
    width: 0.7,
    pencil: true,
  });
  lettering(view.layer, '± — заряд пластин; e⁻ — электроны', {
    x: width / 2,
    y: graphY + graphHeight + 62,
    size: compact ? 14 : 17,
  });
  return {
    view,
    dispose: view.dispose,
    render(state: OscillatorState, reduced: boolean) {
      body.render(state, reduced);
      wc.set(state.electric);
      wl.set(state.magnetic);
      valueC.text(state.electric.toFixed(2));
      valueL.text(state.magnetic.toFixed(2));
      exchange.move(0, 0, state.charge * state.current >= 0 ? 0 : 180);
      exchange.show(Math.abs(state.charge * state.current) > 0.02);
      voltage.at(state.time, state.charge);
      current.at(state.time, state.current);
      cursor.at(graph.point(state.time, 0)[0], 0);
      view.element.dataset.energy = String(state.electric + state.magnetic);
    },
  };
}
