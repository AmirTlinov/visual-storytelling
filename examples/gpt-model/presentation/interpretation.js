import { fmt } from './format.js';
import { MODEL, CONFIG, gelu } from '../model.js';
export function interpretationDrawing(context, components = {}) {
  const { paper, input } = context;
  function drawActivation(d, s) {
    const x = d.compact ? 115 : 180,
      y = d.compact ? 160 : 175,
      w = d.compact ? 1000 : 850,
      h = d.compact ? d.detailActionY - y - 35 : 335;
    const at = (v, output) => [x + ((v + 4) / 8) * w, y + h - ((output + 1) / 5) * h];
    d.line(at(-4, 0), at(4, 0), 'muted', true);
    d.line(at(0, -1), at(0, 4), 'muted', true);
    const g = d.group('gelu-curve', 'green');
    const points = Array.from({ length: 81 }, (_, i) => at(-4 + i / 10, gelu(-4 + i / 10)));
    paper.pen.polyline(g.content, 'gelu-trace', points, { width: 3 });
    const hidden = s.values.term % CONFIG.hiddenWidth;
    const value = s.block.mlp.preactivation[s.token][hidden];
    const point = at(Math.max(-4, Math.min(4, value)), gelu(Math.max(-4, Math.min(4, value))));
    paper.pen.ellipse(g.content, 'gelu-point', point[0], point[1], 8, 8, { fill: 'marker' });
    d.button(
      'hidden-neuron',
      `Нейрон ${hidden + 1} из 32 →`,
      d.compact ? 270 : 800,
      d.compact ? d.detailActionY : 105,
      d.compact ? 740 : 390,
      () => input({ term: (hidden + 1) % CONFIG.hiddenWidth }),
    );
    if (!d.compact) {
      d.text('GELU(h)', 1000, 230, { pigment: 'green', size: 31 });
      d.text(`h = ${fmt(value, 3)} → ${fmt(gelu(value), 3)}`, 100, 578, {
        pigment: 'green',
        size: 31,
      });
    }
  }
  function drawQueryGeometry(d, s) {
    const q = s.head.q[s.token],
      k = s.head.k[s.source],
      a = s.values.axis % 3,
      b = a + 1;
    const plotTop = 155;
    let plotBottom = 530;
    if (!d.compact) {
      const width = d.width - 260,
        gap = Math.max(16, d.size * 0.65),
        footerTop = d.height - d.hit - 10;
      const detailText = `На рисунке только координаты ${a + 1} и ${b + 1}; остальные также участвуют в сумме.`,
        scoreText = `Оценка в 4 координатах: q · k / 2 = ${fmt(s.head.scaledScores[s.token][s.source], 3)}`;
      const detail = d.note(detailText, 0, 0, width, { size: 25, pigment: 'muted' }),
        score = d.note(scoreText, 0, 0, width, { size: 29, pigment: 'ink' });
      const detailTop = footerTop - gap - detail.bounds.height,
        scoreTop = detailTop - gap - score.bounds.height;
      detail.render(detailText, width, 130 - detail.bounds.x, detailTop - detail.bounds.y);
      score.render(scoreText, width, 130 - score.bounds.x, scoreTop - score.bounds.y);
      plotBottom = Math.min(plotBottom, scoreTop - gap);
    }
    const center = [d.width / 2, d.compact ? 340 : (plotTop + plotBottom) / 2],
      unit =
        (d.compact ? 150 : Math.min(115, (plotBottom - plotTop) / 2 - 36)) /
        Math.max(1, Math.abs(q[a]), Math.abs(q[b]), Math.abs(k[a]), Math.abs(k[b]));
    const end = (v) => [center[0] + v[a] * unit, center[1] - v[b] * unit];
    d.line([140, center[1]], [d.width - 100, center[1]], 'muted', true);
    d.line([center[0], plotBottom], [center[0], plotTop], 'muted', true);
    d.line(center, end(q), 'purple', true, 4);
    d.line(center, end(k), 'orange', true, 4);
    d.annotation('query-end', 'q', end(q)[0] + 15, end(q)[1] - 15, 'purple', 3);
    d.annotation('key-end', 'k', end(k)[0] + 15, end(k)[1] + 40, 'orange', 3);
    if (d.compact)
      d.text(`Координаты ${a + 1}, ${b + 1} из 4`, d.width / 2, 483, {
        anchor: 'middle',
        pigment: 'muted',
      });
  }
  function drawGeometry(d, s) {
    if (s.values.view === 'mlp') return drawActivation(d, s);
    const mix = s.values.view === 'attention' && s.values.kind === 'mix';
    if (['attention', 'scores'].includes(s.values.view) && !mix) return drawQueryGeometry(d, s);
    const p = s.values,
      x = mix
        ? s.head.v[s.source].map((v) => v * s.head.probabilities[s.token][s.source])
        : s.block.input[s.token],
      sum = mix ? s.head.output[s.token] : s.block.afterAttention[s.token],
      delta = mix ? sum.map((v, i) => v - x[i]) : s.block.attention.projected[s.token],
      a = p.axis % (x.length - 1),
      b = a + 1;
    const left = d.compact ? 105 : 180,
      top = d.compact ? 160 : 180,
      w = d.compact ? 1000 : 840,
      h = d.compact ? 360 : 340;
    const points = [
      [0, 0],
      [x[a], x[b]],
      [sum[a], sum[b]],
    ];
    const minX = Math.min(...points.map((v) => v[0])),
      maxX = Math.max(...points.map((v) => v[0]));
    const minY = Math.min(...points.map((v) => v[1])),
      maxY = Math.max(...points.map((v) => v[1]));
    const unit = Math.min(
        (w - 200) / Math.max(1, maxX - minX),
        (h - 50) / Math.max(1, maxY - minY),
      ),
      origin = [
        left + w / 2 - ((minX + maxX) * unit) / 2,
        top + h / 2 + ((minY + maxY) * unit) / 2,
      ];
    const pos = (v) => [origin[0] + v[a] * unit, origin[1] - v[b] * unit];
    d.line([left, origin[1]], [left + w, origin[1]], 'muted', true);
    d.line([origin[0], top + h], [origin[0], top], 'muted', true);
    d.line(origin, pos(x), 'purple', true, 4);
    d.line(pos(x), pos(sum), 'orange', true, 4);
    d.line(origin, pos(sum), 'ink', true, 3);
    d.text(`x${a + 1}`, left + w - 55, origin[1] - 17, { pigment: 'muted' });
    d.text(`x${b + 1}`, origin[0] + 18, top + 15, { pigment: 'muted' });
    if (d.compact) {
      d.annotation('vector-before', mix ? 'aV' : 'x', pos(x)[0] - 80, pos(x)[1] - 30, 'purple', 3);
      d.annotation(
        'vector-result',
        mix ? 'Σ aV' : 'x + Δ',
        pos(sum)[0] + 30,
        pos(sum)[1] - 35,
        'ink',
        4,
      );
      d.annotation(
        'vector-delta',
        mix ? 'остальные' : 'Δ',
        (pos(x)[0] + pos(sum)[0]) / 2 + 35,
        (pos(x)[1] + pos(sum)[1]) / 2,
        'orange',
        2,
      );
    }
    if (!d.compact) {
      d.annotation(
        'vector-before',
        mix ? 'выбранный вклад aV' : 'x',
        pos(x)[0] - 25,
        pos(x)[1] - 42,
        'purple',
        3,
      );
      d.annotation(
        'vector-result',
        mix ? 'сумма aV' : 'x + Δ',
        pos(sum)[0] + 20,
        pos(sum)[1] - 35,
        'ink',
        4,
      );
      d.annotation(
        'vector-delta',
        mix ? 'остальные вклады' : 'Δ attention',
        (pos(x)[0] + pos(sum)[0]) / 2 + 25,
        (pos(x)[1] + pos(sum)[1]) / 2,
        'orange',
        2,
      );
      d.text(`Проекция: координаты ${a + 1} и ${b + 1} из ${x.length}.`, 95, 574, {
        size: 24,
        pigment: 'muted',
      });
      d.button('geometry-axis', `Координаты ${a + 1}, ${b + 1} →`, 850, 104, 325, () =>
        input({ axis: (a + 2) % (x.length - 1) }),
      );
    }
  }
  function drawHardware(d, s) {
    const isMLP = s.values.view === 'mlp';
    const isMix = s.values.view === 'attention' && s.values.kind === 'mix';
    const isResidual = ['residual', 'block'].includes(s.values.view);
    if (isResidual) {
      const i = s.values.channel,
        x = s.block.input[s.token][i],
        delta = s.block.attention.projected[s.token][i],
        sum = s.block.afterAttention[s.token][i];
      if (!d.compact)
        d.text(`Координата ${i + 1}: два регистра → сумматор`, d.width / 2, 174, {
          anchor: 'middle',
        });
      const y = d.compact ? 205 : 250,
        h = 100;
      [
        [75, 'x', x, 'purple'],
        [445, 'Δ', delta, 'orange'],
        [905, 'x + Δ', sum, 'ink'],
      ].forEach(([left, label, value, pigment]) => {
        d.box(`register-${label}`, left, y, 280, h, pigment, 'marker');
        d.text(label, left + 140, y - 25, { anchor: 'middle', pigment });
        d.text(fmt(value, 3), left + 140, y + h / 2 + 14, { anchor: 'middle', pigment });
      });
      d.text('+', 384, y + h / 2 + 14);
      d.line([755, y + h / 2], [875, y + h / 2], 'ink', true, 3);
      d.button('channel', `Координата ${i + 1} →`, 300, d.detailActionY, 680, () =>
        input({ channel: (i + 1) % 8 }),
      );
      if (!d.compact)
        d.note(
          'На схеме — поток данных одной операции сложения. Значения совпадают с residual stream.',
          95,
          470,
          1050,
          { size: 27 },
        );
      return;
    }
    const q = isMLP
      ? s.block.mlp.activation[s.token]
      : isMix
        ? s.head.probabilities[s.token]
        : s.head.q[s.token];
    const k = isMLP
      ? MODEL.weights.blocks[s.values.block].contract.weight.map((row) => row[s.values.channel])
      : isMix
        ? s.head.v.map((row) => row[s.values.channel % 4])
        : s.head.k[s.source];
    const index = s.values.term % q.length;
    const product = q[index] * k[index],
      previous = q.slice(0, index).reduce((sum, v, i) => sum + v * k[i], 0),
      result = previous + product;
    if (d.compact) {
      d.text(`${fmt(q[index])} × ${fmt(k[index])}`, d.width / 2, 180, { anchor: 'middle' });
      d.line([d.width / 2, 208], [d.width / 2, 259], 'orange', true);
      d.text(
        `${fmt(previous)} + ${fmt(product)} = ${fmt(result)}`,
        d.width / 2,
        d.detailActionY - 27,
        {
          anchor: 'middle',
        },
      );
      d.button('hardware-step', `Пара ${index + 1}/${q.length} →`, 370, d.detailActionY, 540, () =>
        input({ term: (index + 1) % q.length }),
      );
      return;
    }
    d.text(`Скалярное произведение · пара ${index + 1} из ${q.length}`, 110, 164, { size: 29 });
    const registers = [
      [60, 235, `${isMLP ? 'GELU(h)' : isMix ? 'вес' : 'q'}${index + 1}`, fmt(q[index]), 'purple'],
      [350, 235, `${isMLP ? 'w' : isMix ? 'V' : 'k'}${index + 1}`, fmt(k[index]), 'orange'],
      [640, 358, 'произведение', fmt(product), 'ink'],
      [945, 358, 'накопитель', fmt(result), 'green'],
    ];
    registers.forEach(([x, y, label, value, pigment], i) => {
      d.box(`register-${i}`, x, y, 215, 108, pigment);
      d.text(label, x + 108, y - 16, { anchor: 'middle', size: 26, pigment });
      d.text(value, x + 108, y + 69, { anchor: 'middle', size: 40, pigment });
    });
    d.line([170, 350], [730, 351], 'muted', true);
    d.line([465, 350], [730, 351], 'muted', true);
    d.text('×', 582, 316, { size: 40 });
    d.line([865, 415], [935, 415], 'green', true);
    d.text(`+ ${fmt(previous)}`, 860, 362, { size: 26, pigment: 'green' });
    const bytes = new DataView(new ArrayBuffer(8));
    bytes.setFloat64(0, q[index]);
    const binary = bytes.getBigUint64(0).toString(2).padStart(64, '0');
    d.text(`binary64: знак ${binary[0]}, порядок ${binary.slice(1, 12)}`, 65, 526, {
      size: 24,
      pigment: 'muted',
    });
    d.text('52 бита дробной части', 65, 565, {
      size: 24,
      pigment: 'muted',
    });
    d.button('hardware-step', 'Следующая пара →', 790, d.detailActionY, 350, () =>
      input({ term: (index + 1) % q.length }),
    );
  }
  return { drawActivation, drawQueryGeometry, drawGeometry, drawHardware };
}
