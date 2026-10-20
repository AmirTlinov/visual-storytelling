import { MODEL, CONFIG } from '../model.js';
export function overviewDrawing(context, components = {}) {
  const { input, enter, selectPreset, editPrompt } = context;
  const { tokens, vector } = components;
  function drawOverview(d, s) {
    const p = s.values;
    if (d.compact) {
      tokens(d, s, 110, false);
      d.line([d.width / 2, 110 + d.hit + 16], [d.width / 2, d.detailActionY - 8], 'ink', true, 3);
      d.button(
        'enter-block',
        '2 блока GPT',
        230,
        d.detailActionY,
        d.width - 460,
        () => enter('block'),
        {
          height: d.hit,
          pigment: 'purple',
        },
      );
      d.button('edit-prompt', 'Фраза…', 32, d.height - d.hit - 10, 340, editPrompt);
      d.button('details', 'Модель', 395, d.height - d.hit - 10, 330, () =>
        input({ detailPage: 0 }),
      );
      d.button('next-token', 'Результат →', 748, d.height - d.hit - 10, d.width - 780, () =>
        enter('output'),
      );
      return;
    }
    d.button('edit-prompt', 'Изменить фразу…', 40, 72, 285, editPrompt, { outline: false });
    tokens(d, s, 135);
    const y = 345;
    const blocks = [
      ['embedding', 'Токен + позиция', 60, 220],
      ['block', 'Блок 1', 365, 175],
      ['block', 'Блок 2', 640, 175],
      ['output', 'Следующее слово', 930, 235],
    ];
    const nodes = blocks.map(([view, label, x, w], i) => {
      const node = d.button(
        `node-${i}`,
        label,
        x,
        y - 34,
        w,
        () => enter(view, { block: i === 2 ? 1 : 0 }),
        {
          height: 68,
          pigment: i === 0 || i === 3 ? 'ink' : 'purple',
        },
      );
      if (i === 1 || i === 2) {
        const b = s.trace.blocks[i - 1];
        vector(d, b.output[s.token], x - 14, y + 74, w + 28, {
          id: `overview:block:${i}`,
          source: `blocks.${i - 1}.output`,
          pigment: 'purple',
          numbers: false,
        });
      }
      return node.bounds;
    });
    nodes.slice(1).forEach((next, i) => {
      const previous = nodes[i];
      d.line([previous.x + previous.width + 8, y], [next.x - 8, y], 'purple', true, 5);
    });
    d.annotation(
      'residual-stream',
      'residual stream — вектор, который дополняют блоки',
      323,
      260,
      'purple',
      3,
    );
    d.text('слово → числа', 94, 453, { pigment: 'muted', size: 24 });
    d.text(p.checked ? s.ranking[0].token : '?', 1038, 464, {
      anchor: 'middle',
      size: 57,
      handwriting: 'heading',
    });
    d.button('change-prompt', 'Другая фраза →', 55, 555, 265, selectPreset);
    d.button('enter-model', 'Что обучалось?', 950, 555, 230, () => enter('model'));
  }
  function drawModel(d) {
    if (d.compact) {
      d.text('2 блока · 2 головы · 8 каналов', d.width / 2, 187, { anchor: 'middle' });
      d.text('1960 обученных параметров', d.width / 2, 330, { anchor: 'middle' });
      d.text('18 открытых учебных фраз', d.width / 2, 451, { anchor: 'middle' });
      return;
    }
    d.text(`${MODEL.training.corpus.length} учебных фраз`, 65, 170, { size: 34 });
    MODEL.training.corpus
      .slice(0, 3)
      .forEach((phrase, i) =>
        d.text(phrase.replace(/ \.$/, ''), 65, 246 + i * 62, { size: 29, pigment: 'muted' }),
      );
    d.line([560, 306], [749, 306], 'orange', true, 3);
    d.text('обучение', 654, 269, { anchor: 'middle', size: 26, pigment: 'orange' });
    d.text(`${CONFIG.layers} блока · ${CONFIG.modelWidth} каналов`, 760, 170, {
      size: 30,
      pigment: 'purple',
    });
    for (let i = 0; i < CONFIG.layers; i++) {
      const x = 770 + i * 208;
      d.box(`model-block-${i}`, x, 240, 168, 132, 'purple', 'marker');
      d.text(`Блок ${i + 1}`, x + 84, 295, { anchor: 'middle', size: 30, pigment: 'purple' });
      d.text(`${CONFIG.heads} головы`, x + 84, 345, { anchor: 'middle', size: 25 });
      if (i) d.line([x - 31, 306], [x - 9, 306], 'purple', true);
    }
    d.text(`${MODEL.training.parameterCount} обученных параметров`, 960, 425, {
      anchor: 'middle',
      size: 27,
      pigment: 'purple',
    });
    d.text('Здесь токеном служит целое слово.', 65, 489, { size: 28 });
    d.text('Знакомая фраза ещё не проверяет знание мира.', 65, 541, { size: 28, pigment: 'muted' });
    d.button('model-back', 'Исследовать модель →', 805, 591, 380, () => enter('overview'));
  }
  return { drawOverview, drawModel };
}
