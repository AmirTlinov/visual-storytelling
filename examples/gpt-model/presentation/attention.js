import { percent, tokenName } from './format.js';
export function attentionDrawing(context, components = {}) {
  const { input, enter } = context;
  const { tokens } = components;
  function drawAttention(d, s) {
    const p = s.values,
      weights = s.head.probabilities[s.token];
    if (d.compact) {
      const order = weights
        .map((v, i) => ({ v, i }))
        .filter((x) => x.i <= s.token)
        .sort((a, b) => b.v - a.v)
        .slice(0, 2);
      order.forEach(({ v, i }, row) => {
        const y = 160 + row * 178;
        d.button(
          `source-${i}`,
          tokenName(s.trace.tokens[i]),
          50,
          y,
          405,
          () => input({ source: i }),
          { pressed: s.source === i, pigment: 'orange' },
        );
        d.line([495, y + 70], [820, y + 70], 'orange', true, 2 + v * 10);
        d.text(percent(v), 855, y + 88, { pigment: 'orange' });
      });
      return;
    }
    tokens(d, s, 132, false);
    const target = [905, 425];
    const gap = 14,
      width = (d.width - 100 - gap * (weights.length - 1)) / weights.length;
    weights.forEach((weight, i) => {
      const x = 50 + i * (width + gap);
      d.button(
        `source-${i}`,
        tokenName(s.trace.tokens[i]),
        x,
        295,
        width,
        () => input({ source: i }),
        { pressed: s.source === i, pigment: i > s.token ? 'muted' : 'orange' },
      );
      if (i <= s.token) {
        d.line(
          [x + width / 2, 350],
          [target[0] + 100, target[1]],
          'orange',
          true,
          1.5 + weight * 5,
        );
        d.text(percent(weight), x + width / 2, 280, {
          anchor: 'middle',
          pigment: 'orange',
          size: 23,
        });
      } else
        d.text('закрыто', x + width / 2, 280, { anchor: 'middle', pigment: 'muted', size: 23 });
    });
    d.button(
      'mix-calculation',
      'Взвешенная сумма V',
      target[0] - 180,
      target[1],
      360,
      () => input({ perspective: 'algebra', kind: 'mix', phase: 0 }),
      { pigment: 'orange', height: 65 },
    );
    d.text(`Голова ${p.head + 1} · токен «${tokenName(s.trace.tokens[s.token])}»`, 50, 251, {
      size: 28,
    });
    d.button('other-head', 'Другая голова', 55, d.detailActionY, 250, () =>
      input({ head: 1 - p.head }),
    );
    d.button('score-calculation', 'Откуда вес?', 337, d.detailActionY, 235, () => enter('scores'));
    d.button('projection', 'Q, K, V →', 596, d.detailActionY, 190, () => enter('projection'));
    d.button(
      'ablate-head',
      p.ablate ? 'Вернуть голову' : 'Отключить голову',
      824,
      d.detailActionY,
      325,
      () => input({ ablate: !p.ablate }),
      { pressed: p.ablate },
    );
  }
  return { drawAttention };
}
