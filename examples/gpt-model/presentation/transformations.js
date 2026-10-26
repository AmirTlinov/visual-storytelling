import { fmt, percent, tokenName } from './format.js';
import { CONFIG, gelu } from '../model.js';
export function transformationsDrawing(context, components = {}) {
  const { input, enter } = context;
  const { vector } = components;
  function drawResidual(d, s) {
    const x = d.compact ? 285 : 300,
      width = d.width - x - (d.compact ? 55 : 90);
    const rows = [
      [s.block.input[s.token], 'x до attention', 'purple'],
      [s.block.attention.projected[s.token], 'прибавка Δ', 'orange'],
      [s.block.afterAttention[s.token], 'x + Δ', 'purple'],
    ];
    rows.forEach(([values, label, pigment], i) => {
      const y = d.compact ? 140 + i * 145 : 185 + i * 118;
      if (!d.compact) d.text(i === 1 ? '+' : i === 2 ? '=' : '', 180, y + 40, { size: 40 });
      else d.text(['x', 'Δ', 'x + Δ'][i], 45, y + 72);
      vector(d, values, x, y, width, {
        label: d.compact ? undefined : label,
        id: `residual:row:${i}`,
        source: `blocks.${s.values.block}.${['input', 'attention.projected', 'afterAttention'][i]}`,
        pigment,
        numbers: !d.compact,
      });
    });
    if (!d.compact) {
      d.text('Исходный вектор не стирается: результат блока прибавляется к нему.', 130, 586, {
        size: 28,
      });
      d.button('residual-math', 'Посмотреть сложение', 850, 105, 340, () =>
        input({ perspective: 'algebra', kind: 'residual', phase: 0 }),
      );
    }
  }
  function drawMLP(d, s) {
    if (d.compact) {
      d.text('8 → 32 → 8 координат', d.width / 2, 183, { anchor: 'middle' });
      d.line([120, 340], [1100, 340], 'green', true, 3);
      d.button('gelu', 'GELU', 130, 280, 420, () => input({ perspective: 'geometry' }), {
        pigment: 'green',
      });
      d.button('channel', `Канал ${s.values.channel + 1} →`, 720, 280, 490, () =>
        input({ channel: (s.values.channel + 1) % 8 }),
      );
      return;
    }
    const selected = s.values.channel;
    vector(d, s.block.ln2.output[s.token], 55, 225, 520, {
      label: 'LN(x)',
      numbers: true,
      source: `blocks.${s.values.block}.ln2.output`,
    });
    d.line([590, 260], [680, 260], 'green', true);
    const pre = s.block.mlp.preactivation[s.token],
      activation = s.block.mlp.activation[s.token];
    d.text('32 промежуточных значения', 704, 167, { pigment: 'green', size: 29 });
    pre.forEach((v, i) => {
      const x = 710 + (i % 8) * 57,
        y = 201 + Math.floor(i / 8) * 49;
      const g = d.box(
        `neuron-${i}`,
        x,
        y,
        44,
        36,
        activation[i] >= 0 ? 'green' : 'orange',
        'marker',
      );
      g.element.style.opacity = String(0.25 + 0.75 * Math.min(1, Math.abs(activation[i]) / 3));
    });
    d.text('xW₁ + b₁ → GELU', 185, 350, { size: 30, pigment: 'green' });
    d.line([950, 418], [950, 477], 'green', true);
    vector(d, s.block.mlp.output[s.token], 450, 498, 700, {
      label: 'GELU(h)W₂ + b₂ → прибавка в поток',
      source: `blocks.${s.values.block}.mlp.output`,
      pigment: 'green',
    });
    d.button('channel', `Канал ${selected + 1} →`, 55, d.detailActionY - d.hit - 18, 270, () =>
      input({ channel: (selected + 1) % 8 }),
    );
    d.button('mlp-channel', 'Вычислить координату →', 55, d.detailActionY, 365, () =>
      input({ perspective: 'algebra', kind: 'mlp', phase: 0 }),
    );
  }
  function drawMerge(d, s) {
    const concat = s.block.attention.concat[s.token],
      projected = s.block.attention.projected[s.token];
    if (d.compact) {
      d.text('2 головы × 4 числа → 8 чисел', d.width / 2, 172, { anchor: 'middle' });
      vector(d, concat, 90, 238, d.width - 180, {
        id: 'merge:concat',
        source: `blocks.${s.values.block}.attention.concat`,
        pigment: 'orange',
        numbers: false,
      });
      d.text('Затем Wₒ + bₒ → прибавка к потоку', d.width / 2, 443, { anchor: 'middle' });
      return;
    }
    [0, 1].forEach((head) => {
      vector(d, concat.slice(head * 4, head * 4 + 4), 95 + head * 600, 215, 430, {
        label: `Голова ${head + 1}`,
        id: `merge:head:${head}`,
        source: `blocks.${s.values.block}.attention.concat`,
        offset: head * 4,
        pigment: 'orange',
      });
      d.line([310 + head * 600, 333], [475 + head * 290, 382], 'orange', true, 3);
    });
    d.text('Соединить 4 + 4 → 8, затем × Wₒ + bₒ', 635, 414, { anchor: 'middle', size: 33 });
    vector(d, projected, 190, 491, 910, {
      label: 'Прибавка attention к residual stream',
      id: 'merge:projected',
      source: `blocks.${s.values.block}.attention.projected`,
      pigment: 'purple',
    });
    d.button('merge-residual', 'Прибавить к потоку →', 795, 623, 400, () => enter('residual'));
  }
  function drawNorm(d, s) {
    const n = s.block[s.values.normKind],
      row = n.input[s.token],
      mean = n.mean[s.token],
      variance = n.variance[s.token];
    if (d.compact) {
      d.text(`Среднее μ = ${fmt(mean)}`, d.width / 2, 195, { anchor: 'middle' });
      d.text('(x − μ) / √(σ² + ε)', d.width / 2, 341, { anchor: 'middle' });
      d.text('Затем: γ × результат + β', d.width / 2, 470, { anchor: 'middle' });
      return;
    }
    vector(d, row, 95, 209, 1040, {
      label: 'Исходные координаты',
      pigment: 'purple',
      source: `blocks.${s.values.block}.${s.values.normKind}.input`,
    });
    d.text(`μ = ${fmt(mean, 3)}       σ² = ${fmt(variance, 3)}       ε = 0,00001`, 150, 344, {
      size: 32,
    });
    d.text('(x − μ) / √(σ² + ε) × γ + β', d.width / 2, 411, { anchor: 'middle', size: 36 });
    vector(d, n.output[s.token], 95, 491, 1040, {
      label: 'После LayerNorm',
      pigment: 'ink',
      source: `blocks.${s.values.block}.${s.values.normKind}.output`,
    });
    d.note(
      'Среднее и разброс считаются внутри одного токена. γ и β обучаются отдельно для каждой координаты.',
      115,
      616,
      1020,
      { size: 26 },
    );
  }
  function drawProjection(d, s) {
    const p = s.values,
      headWidth = CONFIG.modelWidth / CONFIG.heads,
      row = p.projection === 'q' ? s.token : s.source;
    const output = s.head[p.projection][row],
      component = p.channel % headWidth;
    const labels = { q: 'Q — сравнивает', k: 'K — с чем сравнить', v: 'V — что передать' };
    if (d.compact) {
      d.text(`«${tokenName(s.trace.tokens[row])}»: 8 → 4 числа`, d.width / 2, 186, {
        anchor: 'middle',
      });
      d.text(
        `${p.projection.toUpperCase()}${component + 1} = ${fmt(output[component], 3)}`,
        d.width / 2,
        285,
        { anchor: 'middle', pigment: 'orange' },
      );
      d.button('projection-kind', `${p.projection.toUpperCase()} →`, 40, d.detailActionY, 300, () =>
        input({ projection: ['q', 'k', 'v'][(['q', 'k', 'v'].indexOf(p.projection) + 1) % 3] }),
      );
      d.button('projection-math', 'Вычислить →', 380, d.detailActionY, 850, () =>
        input({ perspective: 'algebra', kind: 'projection', phase: 0 }),
      );
      return;
    }
    ['q', 'k', 'v'].forEach((id, i) =>
      d.button(
        `projection-${id}`,
        labels[id],
        95 + i * 370,
        140,
        325,
        () => input({ projection: id }),
        { pressed: p.projection === id, pigment: 'orange' },
      ),
    );
    vector(d, s.block.ln1.output[row], 75, 264, 700, {
      label: `LN(x), токен «${tokenName(s.trace.tokens[row])}»`,
      source: `blocks.${s.values.block}.ln1.output`,
      row,
      pigment: 'purple',
    });
    d.line([794, 298], [896, 298], 'orange', true, 3);
    d.box('projection-weight', 920, 234, 240, 170, 'orange', 'marker');
    d.text(`W${p.projection.toUpperCase()} + b`, 1040, 302, {
      anchor: 'middle',
      pigment: 'orange',
      size: 33,
    });
    d.text('обученные веса', 1040, 350, { anchor: 'middle', size: 25 });
    d.line([1040, 412], [1040, 458], 'orange', true, 3);
    vector(d, output, 605, 480, 550, {
      label: `${p.projection.toUpperCase()}, голова ${p.head + 1}`,
      source: `blocks.${p.block}.attention.heads.${p.head}.${p.projection}`,
      row,
      pigment: 'orange',
    });
    d.button('channel', `Координата ${component + 1} →`, 60, 441, 365, () =>
      input({ channel: (component + 1) % headWidth }),
    );
    d.button('projection-math', 'Посчитать из 8 входов →', 60, 520, 395, () =>
      input({ perspective: 'algebra', kind: 'projection', phase: 0 }),
    );
    d.note(
      'Матрицы Q, K и V обучаются независимо; вход у них из того же residual stream.',
      70,
      646,
      1060,
      { size: 26 },
    );
  }
  function drawScores(d, s) {
    const scores = s.head.scaledScores[s.token],
      probs = s.head.probabilities[s.token];
    const normalized = s.head.normalization[s.token],
      exp = normalized.weights,
      total = normalized.totalWeight;
    if (d.compact) {
      const i = s.source;
      d.text(
        `«${tokenName(s.trace.tokens[i])}»: ${i > s.token ? '−∞ · будущее' : fmt(scores[i])}`,
        d.width / 2,
        189,
        {
          anchor: 'middle',
        },
      );
      d.text(`exp(s − max) / Σexp`, d.width / 2, 330, { anchor: 'middle' });
      d.text(`вес = ${percent(probs[i])}`, d.width / 2, 464, {
        anchor: 'middle',
        pigment: 'orange',
      });
      return;
    }
    const headers = ['Откуда', 'q · k / √4', 'После маски', 'exp(s − max)', 'Доля суммы'];
    const xs = [90, 310, 540, 785, 1000];
    headers.forEach((title, i) => d.text(title, xs[i], 168, { size: 26, pigment: 'muted' }));
    scores.forEach((score, i) => {
      const y = 235 + i * Math.min(65, (d.detailActionY - 275) / Math.max(1, scores.length - 1));
      d.text(tokenName(s.trace.tokens[i]), xs[0], y, {
        pigment: i === s.source ? 'orange' : 'ink',
      });
      [
        fmt(score, 3),
        i <= s.token ? fmt(score, 3) : '−∞',
        fmt(exp[i], 3),
        percent(probs[i]),
      ].forEach((value, j) => d.text(value, xs[j + 1], y, { pigment: j === 3 ? 'orange' : 'ink' }));
    });
    d.line([75, 192], [1170, 192], 'muted');
    d.text(`Σ exp = ${fmt(total, 3)}; Σ весов = 1`, 75, d.detailActionY + 42, {
      size: 27,
      pigment: 'orange',
    });
    d.button('score-math', 'Раскрыть q · k →', 775, d.detailActionY, 350, () =>
      input({ perspective: 'algebra', kind: 'score', phase: 0 }),
    );
  }
  return { drawResidual, drawMLP, drawMerge, drawNorm, drawProjection, drawScores };
}
