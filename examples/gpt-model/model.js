import { softmax, rankProbabilities, normalizeLogits } from '@visual-storytelling/core';
export { softmax };
import checkpoint from './checkpoint.json' with { type: 'json' };

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

/** Disclosed, trained toy weights. The browser never calls an inference service. */
export const MODEL = freeze(checkpoint);
export const CONFIG = MODEL.config;
export const VOCAB = MODEL.vocab;
export const PRESETS = freeze([
  { id: 'cat-place', label: 'Кот сидит на…', tokens: ['кот', 'сидит', 'на'], expected: 'ковре' },
  {
    id: 'bird-place',
    label: 'Птица сидит на…',
    tokens: ['птица', 'сидит', 'на'],
    expected: 'ветке',
  },
  { id: 'dog-place', label: 'Пёс сидит на…', tokens: ['пёс', 'сидит', 'на'], expected: 'полу' },
  { id: 'cat-sound', label: 'Кот говорит…', tokens: ['кот', 'говорит'], expected: 'мяу' },
  { id: 'bird-sound', label: 'Птица говорит…', tokens: ['птица', 'говорит'], expected: 'чирик' },
  {
    id: 'position',
    label: 'Сейчас кот сидит на…',
    tokens: ['сейчас', 'кот', 'сидит', 'на'],
    expected: 'ковре',
  },
]);

const vocabulary = new Map(VOCAB.map((token, id) => [token, id]));
const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const sum = (values) => values.reduce((total, value) => total + value, 0);
const copy = (matrix) => matrix.map((row) => [...row]);
const add = (left, right) => left.map((row, i) => row.map((value, j) => value + right[i][j]));

/** Word tokens are deliberately visible; this teaching tokenizer is not GPT's BPE. */
export function tokenize(text) {
  if (typeof text !== 'string') throw new TypeError('Текст должен быть строкой.');
  const tokens =
    text
      .normalize('NFC')
      .toLocaleLowerCase('ru')
      .match(/<начало>|<конец>|[а-яё]+|[^\s]/gu) ?? [];
  for (const token of tokens) {
    if (!vocabulary.has(token)) {
      throw Object.assign(new Error(`Слова «${token}» нет в учебном словаре.`), {
        code: 'unknown_token',
        token,
      });
    }
  }
  return tokens;
}

function inputIds(input) {
  const tokens = typeof input === 'string' ? tokenize(input) : input;
  if (!Array.isArray(tokens)) throw new TypeError('Передайте текст, список слов или ID токенов.');
  const numeric = tokens.every((value) => typeof value === 'number');
  const textual = tokens.every((value) => typeof value === 'string');
  if (!numeric && !textual) throw new TypeError('Нельзя смешивать слова и ID токенов.');
  const ids = tokens.map((token) => {
    const id = numeric ? token : vocabulary.get(token);
    if (!Number.isSafeInteger(id) || id < 0 || id >= VOCAB.length)
      throw Object.assign(new Error(`Неизвестный учебный токен: ${String(token)}`), {
        code: 'unknown_token',
        token,
      });
    return id;
  });
  if (ids[0] !== 0) ids.unshift(0);
  if (ids.slice(1).includes(0)) throw new Error('Токен начала допустим только в начале.');
  if (ids.length > CONFIG.context)
    throw Object.assign(
      new Error(`Учебный контекст вмещает ${CONFIG.context - 1} слов и токен начала.`),
      { code: 'context_limit' },
    );
  return ids;
}

/** Dense affine map; matrix rows are tokens, weight rows are input channels. */
export function linear(input, weight, bias = Array(weight[0]?.length ?? 0).fill(0)) {
  if (
    !Array.isArray(input) ||
    !input.length ||
    !Array.isArray(weight) ||
    !weight.length ||
    !Array.isArray(weight[0]) ||
    !weight[0].length
  )
    throw new Error('Linear needs nonempty matrices.');
  const width = weight[0].length;
  if (
    weight.some((row) => !Array.isArray(row) || row.length !== width || !row.every(finite)) ||
    bias.length !== width ||
    !bias.every(finite) ||
    input.some((row) => !Array.isArray(row) || row.length !== weight.length || !row.every(finite))
  )
    throw new Error('Linear dimensions and finite values must agree.');
  return input.map((row) =>
    Array.from({ length: width }, (_, j) =>
      row.reduce((value, x, i) => value + x * weight[i][j], bias[j]),
    ),
  );
}

/** GPT-2's tanh approximation, shared exactly with the disclosed training script. */
export function gelu(value) {
  if (!finite(value)) throw new Error('GELU needs a finite input.');
  return 0.5 * value * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (value + 0.044715 * value ** 3)));
}

/** Population variance across channels of each token, never across token positions. */
export function layerNorm(input, scale, bias, epsilon = CONFIG.epsilon) {
  const width = scale.length;
  if (
    !width ||
    bias.length !== width ||
    !scale.every(finite) ||
    !bias.every(finite) ||
    !finite(epsilon) ||
    epsilon <= 0 ||
    !Array.isArray(input) ||
    !input.length ||
    input.some((row) => !Array.isArray(row) || row.length !== width || !row.every(finite))
  )
    throw new Error('LayerNorm dimensions, epsilon and finite values must agree.');
  const mean = input.map((row) => sum(row) / width);
  const variance = input.map((row, i) => sum(row.map((value) => (value - mean[i]) ** 2)) / width);
  const normalized = input.map((row, i) =>
    row.map((value) => (value - mean[i]) / Math.sqrt(variance[i] + epsilon)),
  );
  return {
    input: copy(input),
    mean,
    variance,
    normalized,
    scale: [...scale],
    bias: [...bias],
    output: normalized.map((row) => row.map((value, i) => value * scale[i] + bias[i])),
  };
}

/** An immutable forward-pass record shared by the drawing, inspector and MathMorph. */
export function forward(input, { ablateHead } = {}) {
  const ids = inputIds(input);
  const tokens = ids.map((id) => VOCAB[id]);
  const d = CONFIG.modelWidth,
    headWidth = d / CONFIG.heads;
  if (
    ablateHead &&
    (!Number.isSafeInteger(ablateHead.block) ||
      ablateHead.block < 0 ||
      ablateHead.block >= CONFIG.layers ||
      !Number.isSafeInteger(ablateHead.head) ||
      ablateHead.head < 0 ||
      ablateHead.head >= CONFIG.heads)
  )
    throw new Error('Выберите существующий блок и голову для вмешательства.');
  const token = ids.map((id) => [...MODEL.weights.tokenEmbedding[id]]);
  const position = ids.map((_, i) => [...MODEL.weights.positionEmbedding[i]]);
  const embedding = { token, position, residual: add(token, position) };
  let residual = embedding.residual;
  const blocks = MODEL.weights.blocks.map((weights, index) => {
    const input = residual;
    const ln1 = layerNorm(input, weights.ln1.scale, weights.ln1.bias);
    const qkv = linear(ln1.output, weights.qkv.weight, weights.qkv.bias);
    const q = qkv.map((row) => row.slice(0, d));
    const k = qkv.map((row) => row.slice(d, 2 * d));
    const v = qkv.map((row) => row.slice(2 * d));
    const heads = Array.from({ length: CONFIG.heads }, (_, head) => {
      const start = head * headWidth;
      const queries = q.map((row) => row.slice(start, start + headWidth));
      const keys = k.map((row) => row.slice(start, start + headWidth));
      const values = v.map((row) => row.slice(start, start + headWidth));
      const scores = queries.map((query) =>
        keys.map((key) => sum(query.map((value, i) => value * key[i]))),
      );
      const scaledScores = scores.map((row) => row.map((value) => value / Math.sqrt(headWidth)));
      const maskedScores = scaledScores.map((row, i) =>
        row.map((value, j) => (j <= i ? value : null)),
      );
      const normalization = maskedScores.map((row) =>
        normalizeLogits(row.map((value) => (value === null ? -Infinity : value))),
      );
      const probabilities = normalization.map((trace) => trace.probabilities);
      const weightedValues = probabilities.map((row) =>
        row.map((probability, j) => values[j].map((value) => probability * value)),
      );
      const output = weightedValues.map((contributions) =>
        Array.from({ length: headWidth }, (_, c) => sum(contributions.map((row) => row[c]))),
      );
      const ablated = ablateHead?.block === index && ablateHead.head === head;
      const usedOutput = ablated ? output.map((row) => row.map(() => 0)) : output;
      return {
        index: head,
        q: queries,
        k: keys,
        v: values,
        scores,
        scaledScores,
        maskedScores,
        normalization,
        probabilities,
        weightedValues,
        output,
        usedOutput,
        ablated,
      };
    });
    const concat = ids.map((_, i) => heads.flatMap((head) => head.usedOutput[i]));
    const projected = linear(concat, weights.projection.weight, weights.projection.bias);
    const attention = { qkv, q, k, v, heads, concat, projected };
    const afterAttention = add(input, projected);
    const ln2 = layerNorm(afterAttention, weights.ln2.scale, weights.ln2.bias);
    const preactivation = linear(ln2.output, weights.expand.weight, weights.expand.bias);
    const activation = preactivation.map((row) => row.map(gelu));
    const output = linear(activation, weights.contract.weight, weights.contract.bias);
    const mlp = { preactivation, activation, output };
    residual = add(afterAttention, output);
    return { index, input, ln1, attention, afterAttention, ln2, mlp, output: residual };
  });
  const finalNorm = layerNorm(
    residual,
    MODEL.weights.finalNorm.scale,
    MODEL.weights.finalNorm.bias,
  );
  const unembedding = Array.from({ length: d }, (_, channel) =>
    MODEL.weights.tokenEmbedding.map((row) => row[channel]),
  );
  const logits = linear(finalNorm.output, unembedding);
  const normalization = logits.map((row) => normalizeLogits(row));
  const probabilities = normalization.map((trace) => trace.probabilities);
  const ranking = rankingAt({ logits, probabilities }, ids.length - 1);
  return freeze({
    tokens,
    ids,
    embedding,
    blocks,
    finalNorm,
    logits,
    normalization,
    probabilities,
    next: { ...ranking[0] },
    ranking,
    intervention: ablateHead
      ? { kind: 'ablate-head', block: ablateHead.block, head: ablateHead.head }
      : null,
  });
}

export function rankingAt(trace, token = trace.logits.length - 1) {
  if (!Number.isSafeInteger(token) || token < 0 || token >= trace.logits.length)
    throw new Error('Выберите существующую позицию токена.');
  return rankProbabilities(trace.probabilities[token]).map((id) => ({
    id,
    token: VOCAB[id],
    logit: trace.logits[token][id],
    probability: trace.probabilities[token][id],
  }));
}

/** Greedy decoding is explicit; it is not sampling and does not imply certainty. */
export function generate(input, count = 1) {
  if (!Number.isSafeInteger(count) || count < 0 || count > CONFIG.context)
    throw new Error('Choose a nonnegative generation count within the context limit.');
  const ids = inputIds(input),
    steps = [];
  for (let step = 0; step < count && ids.length < CONFIG.context && ids.at(-1) !== 1; step++) {
    const trace = forward(ids);
    steps.push(trace);
    ids.push(trace.next.id);
  }
  return {
    tokens: ids.map((id) => VOCAB[id]),
    ids,
    steps,
    ended: ids.at(-1) === 1,
    contextFull: ids.length === CONFIG.context,
  };
}
