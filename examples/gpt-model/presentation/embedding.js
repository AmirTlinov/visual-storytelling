import { tokenName } from './format.js';
export function embeddingDrawing(context, components = {}) {
  const { input, enter } = context;
  const { vector } = components;
  function drawEmbedding(d, s) {
    if (d.compact) {
      d.text(`«${tokenName(s.trace.tokens[s.token])}» + позиция ${s.token}`, d.width / 2, 190, {
        anchor: 'middle',
      });
      vector(d, s.trace.embedding.residual[s.token], 70, 270, d.width - 140, {
        source: 'embedding.residual',
        pigment: 'purple',
        numbers: false,
      });
      d.text('8 координат одного токена', d.width / 2, 440, { anchor: 'middle' });
      return;
    }
    const x = 285,
      w = 795;
    d.sequence('embedding.word', () =>
      vector(d, s.trace.embedding.token[s.token], x, 210, w, {
        label: `Таблица слова «${tokenName(s.trace.tokens[s.token])}»`,
        id: 'embedding:token',
        source: 'weights.tokenEmbedding',
        row: s.trace.ids[s.token],
        height: 55,
      }),
    );
    d.sequence('embedding.position', () => {
      d.text('+', x - 75, 375, { size: 50 });
      vector(d, s.trace.embedding.position[s.token], x, 340, w, {
        label: `Таблица позиции ${s.token}`,
        id: 'embedding:position',
        source: 'weights.positionEmbedding',
        pigment: 'orange',
        height: 55,
      });
    });
    d.sequence('embedding.sum', () => {
      d.line([x - 20, 425], [x + w + 20, 425], 'muted');
      vector(d, s.trace.embedding.residual[s.token], x, 480, w, {
        label: 'Начало residual stream',
        id: 'embedding:sum',
        source: 'embedding.residual',
        pigment: 'purple',
        height: 55,
      });
    });
    d.button('change-position', '«на»: другая позиция →', 55, 550, 345, () =>
      input({ preset: s.values.preset === 'position' ? 'cat-place' : 'position' }),
    );
    d.note('Одинаковое слово получает другую добавку в другом месте фразы.', 420, 582, 660, {
      size: 26,
    });
  }
  function drawBlock(d, s) {
    if (d.compact) {
      d.button('attention', 'Attention', 75, 140, 470, () => enter('attention'), {
        pigment: 'orange',
      });
      d.button('mlp', 'MLP', 735, 140, 470, () => enter('mlp'), { pigment: 'green' });
      d.line([120, 430], [1150, 430], 'purple', true, 5);
      d.line([310, 300], [310, 430], 'orange', true);
      d.line([970, 300], [970, 430], 'green', true);
      d.text('x', 80, 402);
      d.text('+', 282, 464);
      d.text('+', 941, 464);
      return;
    }
    const y = 455;
    [
      [90, 357],
      [419, 857],
      [919, 1170],
    ].forEach(([a, b]) => d.line([a, y], [b, y], 'purple', true, 5));
    for (const [name, title, x, pigment] of [
      ['attention', 'Attention', 280, 'orange'],
      ['mlp', 'MLP', 780, 'green'],
    ]) {
      d.sequence(`block.${name}`, () => {
        d.line([x - 105, y], [x - 105, 336], 'muted', true);
        d.line([x - 105, 279], [x - 105, 255], 'muted');
        d.button(
          `${name}-norm`,
          'LN',
          x - 142,
          280,
          74,
          () => enter('norm', { normKind: name === 'attention' ? 'ln1' : 'ln2' }),
          { height: 52, pigment: 'muted' },
        );
        d.line([x - 105, 255], [x, 255], pigment, true);
        d.button(name, title, x, 215, 215, () => enter(name), { height: 80, pigment });
        d.line([x + 108, 295], [x + 108, y - 28], pigment, true, 3);
        d.box(`${name}-sum`, x + 82, y - 26, 52, 52, 'purple');
        d.text('+', x + 108, y + 12, { anchor: 'middle', size: 42 });
      });
    }
    d.text('x', 62, y + 14, { size: 39, pigment: 'purple' });
    d.annotation('attention-local', 'Собрать сведения из прошлых токенов', 156, 155, 'orange');
    d.annotation('mlp-local', 'Преобразовать каждый вектор отдельно', 735, 155, 'green');
    d.button('next-block', `Блок ${s.values.block + 1} из 2 →`, 55, d.detailActionY, 235, () =>
      input({ block: 1 - s.values.block }),
    );
    d.button('residual', 'Проследить прибавку →', 730, d.detailActionY, 355, () =>
      enter('residual'),
    );
  }
  return { drawEmbedding, drawBlock };
}
