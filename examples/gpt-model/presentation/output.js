import { fmt, percent, tokenName } from './format.js';
import { MODEL, CONFIG } from '../model.js';
export function outputDrawing(context, components = {}) {
  const { input, enter, selectPreset } = context;
  const { vector } = components;
  function predictionChoices(s) {
    if (s.token === s.trace.tokens.length - 1 && !s.values.generated) {
      const category = [
        ['гав', 'мяу', 'чирик'],
        ['ковре', 'ветке', 'полу'],
      ].find((words) => words.includes(s.ranking[0].token));
      if (category) return category;
    }
    return s.ranking
      .slice(0, 3)
      .map((item) => item.token)
      .sort();
  }
  function drawOutput(d, s) {
    const p = s.values,
      ranking = s.ranking.slice(0, d.compact ? 2 : 4);
    if (p.guess && !ranking.some((item) => item.token === p.guess))
      ranking[ranking.length - 1] = s.ranking.find((item) => item.token === p.guess);
    if (!p.checked) {
      d.text(
        d.compact
          ? 'Чем продолжится фраза?'
          : `«${s.trace.tokens.slice(1, s.token + 1).join(' ')} …»`,
        d.width / 2,
        d.compact ? 166 : 232,
        { anchor: 'middle', size: d.compact ? d.size : 42 },
      );
      const choices = predictionChoices(s);
      choices.forEach((word, i) =>
        d.button(
          `guess-${word}`,
          word,
          d.compact ? 30 + i * 415 : 225 + i * 285,
          d.compact ? 252 : 324,
          d.compact ? 390 : 235,
          () => input({ guess: word }),
          { pressed: p.guess === word },
        ),
      );
      if (p.guess)
        d.button(
          'check-prediction',
          'Проверить →',
          d.compact ? 220 : 480,
          d.compact ? d.height - d.hit - 10 : 469,
          d.compact ? d.width - 260 : 310,
          () => input({ checked: true }),
        );
      return;
    }
    ranking.forEach((item, i) => {
      const y = (d.compact ? 162 : 203) + i * (d.compact ? 185 : 91);
      const token = item.token ?? MODEL.vocab[item.id];
      const probability = item.probability;
      d.button(
        `output-word-${item.id}`,
        `${tokenName(token)} →`,
        d.compact ? 38 : 145,
        y - d.hit / 2,
        d.compact ? 390 : 215,
        () => enter('logits', { candidate: item.id }),
        { pigment: i === 0 ? 'green' : 'ink', outline: false },
      );
      if (p.guess === token)
        d.text('ваш выбор', d.compact ? 60 : 40, y + (d.compact ? 65 : 32), { pigment: 'muted' });
      const x = d.compact ? 500 : 390,
        w = d.compact ? 380 : 500;
      d.probability(`prob-${item.id}`, probability, x, y - 30, w, 38, {
        label: `Вероятность токена ${tokenName(token)}`,
        value: () => probability,
        unit: '1',
        provenance: () => ({
          token: s.token,
          candidate: item.id,
          logit: item.logit,
          model: MODEL.format,
        }),
        interactive: false,
      });
    });
    const generate = () =>
      s.token !== s.trace.tokens.length - 1
        ? input({ token: s.trace.tokens.length - 1 })
        : input({
            generated: !p.generated,
            token: s.trace.tokens.length + (p.generated ? -2 : 0),
            view: 'overview',
          });
    const full =
      !p.generated &&
      s.trace.tokens.length >= CONFIG.context &&
      s.token === s.trace.tokens.length - 1;
    if (full)
      d.text('Контекст заполнен: сократите фразу.', d.width / 2, d.height - d.hit / 2 - 10, {
        anchor: 'middle',
        pigment: 'muted',
      });
    if (d.compact && !full)
      d.button(
        'generate',
        p.generated
          ? 'Вернуть ↶'
          : s.token === s.trace.tokens.length - 1
            ? 'Добавить →'
            : 'К концу →',
        625,
        d.height - d.hit - 10,
        d.width - 665,
        generate,
      );
    if (!d.compact) {
      d.text('logits → softmax → распределение', 390, 142, { size: 28, pigment: 'muted' });
      d.text('Выбираем наибольшую вероятность.', 160, 548, { size: 25, pigment: 'muted' });
      if (!full)
        d.button(
          'generate',
          p.generated
            ? 'Исходная фраза ↶'
            : s.token === s.trace.tokens.length - 1
              ? `Добавить «${s.trace.next.token}» →`
              : 'К последнему токену →',
          850,
          d.height - d.hit - 30,
          335,
          generate,
          { pressed: p.generated },
        );
      d.button('change-prompt', 'Другая фраза', 160, d.height - d.hit - 30, 300, selectPreset);
    }
  }
  function drawLogits(d, s) {
    const candidate = s.candidate,
      word = tokenName(MODEL.vocab[candidate]);
    const vectorRow = s.trace.finalNorm.output[s.token],
      embedding = MODEL.weights.tokenEmbedding[candidate];
    const normalized = s.trace.normalization[s.token],
      score = normalized.scores[candidate];
    if (d.compact) {
      d.text(`Вектор · веса слова «${word}»`, d.width / 2, 177, { anchor: 'middle' });
      d.text(`оценка = ${fmt(score, 3)}`, d.width / 2, 283, { anchor: 'middle', pigment: 'green' });
      d.button('logit-math', 'Раскрыть 8 произведений →', 40, d.detailActionY, d.width - 80, () =>
        input({ perspective: 'algebra', kind: 'logit', phase: 0 }),
      );
      return;
    }
    vector(d, vectorRow, 245, 184, 865, {
      label: 'Итог после двух блоков и final LayerNorm',
      id: 'logits:normalized',
      source: 'finalNorm.output',
      pigment: 'purple',
    });
    vector(d, embedding, 245, 337, 865, {
      label: `Обученный вектор слова «${word}»`,
      id: 'logits:weights',
      source: 'weights.tokenEmbedding',
      row: candidate,
      pigment: 'green',
    });
    d.text('·', 166, 318, { size: 72 });
    d.text(`оценка = ${fmt(score, 3)}`, 78, 491, { size: 32, pigment: 'green' });
    d.text(
      `exp(${fmt(score, 2)} − max) / Σexp = ${percent(normalized.probabilities[candidate])}`,
      455,
      491,
      {
        size: 28,
      },
    );
    d.text('Те же веса, что при входе слова. Нормируем оценки всех 17 слов.', 78, 546, {
      pigment: 'muted',
      size: 25,
    });
    d.button('logit-math', 'Раскрыть 8 произведений →', 78, 585, 455, () =>
      input({ perspective: 'algebra', kind: 'logit', phase: 0 }),
    );
    d.button('logit-candidate', `Слово «${word}» →`, 735, 585, 420, () =>
      input({ candidate: (candidate + 1) % MODEL.vocab.length }),
    );
  }
  return { predictionChoices, drawOutput, drawLogits };
}
