import { tokenName } from './format.js';
import { PRESETS } from '../model.js';
export function detailsDrawing(context, components = {}) {
  const { input } = context;
  function drawDetails(d, s) {
    const p = s.values;
    const item = (label, patch) => ({ label, patch });
    const short = {
      overview: 'Вся модель',
      embedding: 'Токен + позиция',
      block: 'Блок GPT',
      attention: 'Attention',
      scores: 'Оценки → веса',
      projection: 'Q, K и V',
      norm: 'LayerNorm',
      residual: 'Residual stream',
      mlp: 'MLP',
      output: 'Следующее слово',
      logits: 'Оценка слова',
      merge: 'Объединить головы',
      model: 'Устройство модели',
    };
    const open = (view, patch = {}) =>
      item(short[view], { view, perspective: 'diagram', ...patch });
    const context = [
      item(`Токен: ${tokenName(s.trace.tokens[s.token])} →`, {
        token: (s.token + 1) % s.trace.tokens.length,
      }),
      item(`Источник: ${tokenName(s.trace.tokens[s.source])} →`, {
        source: (s.source + 1) % s.trace.tokens.length,
      }),
      item(`Голова ${p.head + 1} →`, { head: 1 - p.head }),
      item(p.ablate ? 'Вернуть голову' : 'Отключить голову', { ablate: !p.ablate }),
    ];
    const items = {
      overview: [
        open('embedding'),
        open('model'),
        item('Изменить фразу', {
          preset: PRESETS[(PRESETS.findIndex((v) => v.id === p.preset) + 1) % PRESETS.length].id,
        }),
        open('output'),
      ],
      embedding: [
        item('«на»: другая позиция', {
          preset: p.preset === 'position' ? 'cat-place' : 'position',
        }),
        open('overview'),
        open('model'),
      ],
      block: [
        open('attention'),
        open('mlp'),
        open('residual'),
        item(`Блок ${p.block + 1} →`, { block: 1 - p.block }),
        item('LN до attention', { view: 'norm', normKind: 'ln1' }),
        item('LN до MLP', { view: 'norm', normKind: 'ln2' }),
      ],
      attention: [
        open('scores'),
        open('projection'),
        item('Сумма вес × V', { perspective: 'algebra', kind: 'mix', phase: 0 }),
        open('merge'),
        ...context,
      ],
      scores: [open('projection'), open('attention'), ...context],
      projection: [
        ...['q', 'k', 'v'].map((projection) =>
          item(`Проекция ${projection.toUpperCase()}`, { projection }),
        ),
        item(`Координата ${(p.channel % 4) + 1} →`, { channel: (p.channel + 1) % 4 }),
        ...context,
      ],
      residual: [
        item(`Координата ${p.channel + 1} →`, { channel: (p.channel + 1) % 8 }),
        item(`Плоскость ${p.axis + 1}, ${p.axis + 2} →`, { axis: (p.axis + 2) % 7 }),
        open('merge'),
        open('block'),
      ],
      mlp: [
        item(`Нейрон ${p.term + 1} →`, { term: (p.term + 1) % 32, perspective: 'geometry' }),
        item(`Выход ${p.channel + 1} →`, { channel: (p.channel + 1) % 8 }),
        open('norm', { normKind: 'ln2' }),
        open('block'),
      ],
      output: [
        open('logits'),
        item('Изменить фразу', {
          preset: PRESETS[(PRESETS.findIndex((v) => v.id === p.preset) + 1) % PRESETS.length].id,
        }),
        ...context.slice(0, 1),
      ],
      logits: [
        item('Посчитать оценку', { perspective: 'algebra', phase: 0 }),
        ...s.ranking
          .slice(0, 3)
          .map((r) => item(`Слово «${tokenName(r.token)}»`, { candidate: r.id })),
      ],
      norm: [
        item('LN до attention', { normKind: 'ln1' }),
        item('LN до MLP', { normKind: 'ln2' }),
        open('block'),
      ],
      merge: [open('attention'), open('residual'), ...context.slice(2)],
      model: [open('overview'), open('embedding')],
    }[p.view];
    const margin = 35,
      gap = 24,
      available = d.width - 2 * margin;
    const measured = items.map((entry, index) => ({
      ...entry,
      index,
      ...d.buttonSize(entry.label),
    }));
    const rows = [];
    for (let index = 0; index < measured.length; ) {
      const first = measured[index++],
        second = measured[index];
      // The complete lettering participates in layout before any hit target is placed.
      const pair = second && first.width + gap + second.width <= available;
      rows.push(pair ? [first, measured[index++]] : [first]);
    }
    const pages = Math.ceil(rows.length / 2),
      page = Math.min(p.detailPage, pages - 1);
    let y = 140;
    for (const row of rows.slice(page * 2, page * 2 + 2)) {
      const extra =
        (available - gap * (row.length - 1) - row.reduce((sum, entry) => sum + entry.width, 0)) /
        row.length;
      const height = Math.max(...row.map((entry) => entry.height));
      let x = margin;
      for (const entry of row) {
        const width = entry.width + extra;
        d.button(
          `detail-${entry.index}`,
          entry.label,
          x,
          y,
          width,
          () => input({ ...entry.patch, detailPage: -1 }),
          { height },
        );
        x += width + gap;
      }
      y += height + gap;
    }
    d.button('details-back', '←', 24, d.height - d.hit - 10, d.hit, () =>
      input({ detailPage: -1 }),
    );
    if (pages > 1)
      d.button(
        'details-next',
        `Ещё · ${page + 1}/${pages} →`,
        300,
        d.height - d.hit - 10,
        940,
        () => input({ detailPage: (page + 1) % pages }),
      );
  }
  return { drawDetails };
}
