import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CONFIG,
  MODEL,
  PRESETS,
  VOCAB,
  forward,
  gelu,
  generate,
  layerNorm,
  linear,
  rankingAt,
  softmax,
  tokenize,
} from '../examples/gpt-model/model.js';

function close(actual, expected, tolerance = 2e-11) {
  if (Array.isArray(expected)) {
    assert.equal(actual.length, expected.length);
    expected.forEach((value, index) => close(actual[index], value, tolerance));
  } else assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ≠ ${expected}`);
}

test('the browser decoder agrees with the independent PyTorch forward pass on every token', () => {
  for (const reference of MODEL.references) {
    const result = forward(reference.tokens);
    close(result.logits, reference.logits);
    close(result.probabilities, reference.probabilities);
    assert.deepEqual(
      result.normalization.map((row) => row.probabilities),
      result.probabilities,
    );
    assert.ok(result.normalization.every((row) => Math.abs(row.totalProbability - 1) < 1e-14));
    assert.equal(result.next.token, reference.expected);
    assert.ok(result.next.probability > 0.99);
  }
});

test('public forward traces cannot mutate the live numbers shared with inspection and calculation', () => {
  const options = { ablateHead: { block: 0, head: 1 } };
  const trace = forward(PRESETS[0].tokens, options);
  const original = structuredClone(trace);
  for (const mutate of [
    () => trace.tokens.push('<конец>'),
    () => trace.embedding.token[1].fill(0),
    () => {
      trace.blocks[0].attention.heads[0].q[1][0] += 1;
    },
    () => trace.blocks[1].input[0].reverse(),
    () => trace.logits.at(-1).sort((a, b) => a - b),
    () => {
      trace.ranking[0].probability = 0;
    },
    () => {
      trace.next.token = 'мяу';
    },
    () => {
      trace.intervention.head = 0;
    },
  ])
    assert.throws(mutate, TypeError);
  assert.deepEqual(trace, original, 'inspection cannot alter cached calculation operands');
  assert.deepEqual(rankingAt(trace), original.ranking);
  assert.deepEqual(forward(PRESETS[0].tokens, options), original);
});

test('the checkpoint discloses its complete artificial corpus, tokenizer and compact architecture', () => {
  assert.equal(MODEL.format, 'visual-storytelling.teaching-gpt.v1');
  assert.deepEqual(CONFIG, {
    modelWidth: 8,
    heads: 2,
    layers: 2,
    hiddenWidth: 32,
    context: 8,
    epsilon: 1e-5,
  });
  assert.equal(MODEL.training.corpus.length, 18);
  assert.equal(
    createHash('sha256').update(MODEL.training.corpus.join('\n')).digest('hex'),
    MODEL.training.corpusSha256,
  );
  assert.equal(MODEL.training.parameterCount, 1960);
  assert.match(MODEL.training.description, /not weights from a commercial GPT/);
  assert.match(MODEL.training.tokenizer, /word-level/);
  assert.ok(MODEL.training.finalLoss < MODEL.training.initialLoss / 3);
  assert.throws(() => {
    MODEL.weights.tokenEmbedding[0][0] = 100;
  }, TypeError);
});

test('causal attention never observes a future token, including in the second block', () => {
  const prefix = forward(['кот', 'сидит', 'на']);
  const first = forward(['кот', 'сидит', 'на', 'ковре']);
  const changed = forward(['кот', 'сидит', 'на', 'полу']);
  close(first.logits.slice(0, 4), prefix.logits, 1e-13);
  close(changed.logits.slice(0, 4), prefix.logits, 1e-13);
  for (let block = 0; block < CONFIG.layers; block++) {
    close(first.blocks[block].output.slice(0, 4), changed.blocks[block].output.slice(0, 4), 1e-13);
    for (const head of first.blocks[block].attention.heads) {
      for (let token = 0; token < first.ids.length; token++) {
        assert.deepEqual(head.normalization[token].probabilities, head.probabilities[token]);
        assert.deepEqual(
          head.normalization[token].masked,
          head.maskedScores[token].map((value) => value === null),
        );
        close(
          head.probabilities[token].reduce((a, b) => a + b, 0),
          1,
          1e-14,
        );
        for (let source = token + 1; source < first.ids.length; source++) {
          assert.equal(head.maskedScores[token][source], null);
          assert.equal(head.probabilities[token][source], 0);
          assert.ok(head.weightedValues[token][source].every((value) => value === 0));
        }
      }
    }
  }
});

test('the residual stream retains the input and adds the two independently computed branch outputs', () => {
  const trace = forward(PRESETS[0].tokens);
  const plus = (a, b) => a.map((row, i) => row.map((value, j) => value + b[i][j]));
  close(trace.embedding.residual, plus(trace.embedding.token, trace.embedding.position));
  let previous = trace.embedding.residual;
  for (const block of trace.blocks) {
    close(block.input, previous);
    close(block.afterAttention, plus(block.input, block.attention.projected));
    close(block.output, plus(block.afterAttention, block.mlp.output));
    assert.equal(block.mlp.activation[0].length, 32);
    assert.equal(block.attention.heads.length, 2);
    assert.equal(block.attention.heads[0].q[0].length, 4);
    previous = block.output;
  }
  close(trace.finalNorm.input, previous);
  const tied = MODEL.weights.tokenEmbedding.map((embedding) =>
    embedding.reduce(
      (sum, weight, channel) => sum + weight * trace.finalNorm.output.at(-1)[channel],
      0,
    ),
  );
  close(trace.logits.at(-1), tied);
});

test('LayerNorm normalizes each token across channels with population variance and learned affine values', () => {
  const result = layerNorm(
    [
      [1, 2, 3, 4],
      [10, 10, 10, 10],
    ],
    [1, 2, -1, 0],
    [0, 1, 2, 3],
    0.25,
  );
  close(result.mean, [2.5, 10]);
  close(result.variance, [1.25, 0]);
  close(
    result.normalized[0],
    [-1.5, -0.5, 0.5, 1.5].map((value) => value / Math.sqrt(1.5)),
  );
  close(result.output[1], [0, 1, 2, 3]);
  close(result.output[0], [
    -1.5 / Math.sqrt(1.5),
    1 - 1 / Math.sqrt(1.5),
    2 - 0.5 / Math.sqrt(1.5),
    3,
  ]);
});

test('primitive affine arithmetic, stable softmax and GELU match their stated mathematics', () => {
  close(
    linear(
      [[2, -1]],
      [
        [3, 4],
        [5, 6],
      ],
      [1, -2],
    ),
    [[2, 0]],
  );
  close(softmax([1000, 1001, -Infinity]), [1 / (1 + Math.E), Math.E / (1 + Math.E), 0]);
  close(softmax([-1000, -1001]), softmax([0, -1]));
  assert.equal(gelu(0), 0);
  close(gelu(1) - gelu(-1), 1);
  assert.throws(() => softmax([-Infinity, -Infinity]));
  assert.throws(() =>
    linear(
      [[1]],
      [
        [1, 2],
        [3, 4],
      ],
    ),
  );
  assert.throws(() => layerNorm([[1, NaN]], [1, 1], [0, 0]));
});

test('the same last token predicts different learned continuations when the earlier subject changes', () => {
  const trace = PRESETS.slice(0, 3).map((preset) => forward(preset.tokens));
  assert.ok(trace.every((item) => item.tokens.at(-1) === 'на'));
  assert.deepEqual(
    trace.map((item) => item.next.token),
    ['ковре', 'ветке', 'полу'],
  );
  for (const preset of PRESETS) assert.equal(forward(preset.tokens).next.token, preset.expected);
  assert.notDeepEqual(MODEL.weights.positionEmbedding[0], MODEL.weights.positionEmbedding[1]);
});

test('head ablation changes only the branch used in the forward pass and preserves disclosed weights', () => {
  const ordinary = forward(PRESETS[0].tokens);
  const altered = forward(PRESETS[0].tokens, { ablateHead: { block: 0, head: 1 } });
  assert.deepEqual(altered.intervention, { kind: 'ablate-head', block: 0, head: 1 });
  close(altered.blocks[0].attention.heads[1].output, ordinary.blocks[0].attention.heads[1].output);
  assert.ok(altered.blocks[0].attention.heads[1].usedOutput.flat().every((value) => value === 0));
  close(
    altered.blocks[0].attention.heads[0].usedOutput,
    ordinary.blocks[0].attention.heads[0].usedOutput,
  );
  assert.ok(
    altered.logits.at(-1).some((value, i) => Math.abs(value - ordinary.logits.at(-1)[i]) > 1e-4),
  );
  assert.deepEqual(forward(PRESETS[0].tokens), ordinary);
  assert.throws(() => forward(PRESETS[0].tokens, { ablateHead: { block: 3, head: 0 } }));
});

test('word tokenization is explicit and rejects unknown words, mixed IDs and context overflow', () => {
  assert.deepEqual(tokenize('Кот сидит на ковре.'), ['кот', 'сидит', 'на', 'ковре', '.']);
  assert.deepEqual(forward('кот сидит на').ids, forward([2, 5, 6]).ids);
  assert.deepEqual(forward([]).tokens, ['<начало>']);
  assert.throws(() => forward('тигр сидит на'), { code: 'unknown_token' });
  assert.throws(() => forward(['кот', 5]));
  assert.throws(() => forward(['кот', '<начало>']));
  assert.throws(() => forward(Array(8).fill('кот')), { code: 'context_limit' });
  const input = ['кот', 'сидит', 'на'];
  forward(input);
  assert.deepEqual(input, ['кот', 'сидит', 'на']);
});

test('ranking and greedy generation use actual logits without mutating their input', () => {
  const result = generate(['кот', 'сидит', 'на'], 4);
  assert.deepEqual(result.tokens, ['<начало>', 'кот', 'сидит', 'на', 'ковре', '.', '<конец>']);
  assert.equal(result.ended, true);
  assert.equal(result.steps.length, 3);
  const trace = result.steps[0];
  assert.deepEqual(rankingAt(trace), trace.ranking);
  assert.equal(rankingAt(trace, 0).length, VOCAB.length);
  assert.throws(() => rankingAt(trace, 100));
  assert.deepEqual(generate(PRESETS[0].tokens, 0).steps, []);
});
