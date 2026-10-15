import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeLogits,
  softmax,
  probabilityRows,
  wilsonInterval,
  sampleBernoulli,
  binomialPrefix,
  rankProbabilities,
  probabilityModel,
  samplingModel,
} from '../dist/index.js';
const close = (a, b, tolerance = 1e-14) => assert.ok(Math.abs(a - b) < tolerance, `${a} vs ${b}`);
test('normalization preserves masks, shift invariance, order and finite extremes', () => {
  const trace = normalizeLogits([1000, 1001, -Infinity]);
  close(trace.probabilities[0], 1 / (1 + Math.E));
  close(trace.probabilities[1], Math.E / (1 + Math.E));
  assert.equal(trace.probabilities[2], 0);
  assert.deepEqual(trace.masked, [false, false, true]);
  assert.deepEqual(JSON.parse(JSON.stringify(trace)), trace);
  close(trace.totalProbability, 1);
  assert.deepEqual(softmax([-1000, -1001]), softmax([0, -1]));
  close(normalizeLogits([1e308, -1e308], 1e308).probabilities[1], 1 / (1 + Math.exp(2)));
  assert.deepEqual(
    [
      [1, 2],
      [1, 2],
    ].map(softmax),
    [softmax([1, 2]), softmax([1, 2])],
  );
  const large = normalizeLogits(Array.from({ length: 100000 }, () => 2));
  close(large.totalProbability, 1);
  close(large.probabilities[99999], 1e-5);
  assert.throws(() => softmax([1, , 2]));
  assert.throws(() => probabilityRows(trace, ['a', , 'c']));
  assert.throws(() => softmax([-Infinity, -Infinity]));
  assert.throws(() => softmax([NaN, 1]));
  assert.throws(() => normalizeLogits([1], 0));
  assert.throws(() => normalizeLogits([Infinity, 1]));
  assert.deepEqual(rankProbabilities([0.3, 0.4, 0.3]), [1, 0, 2]);
  assert.throws(() => rankProbabilities([0.3, , 0.7]));
  assert.throws(() => probabilityModel.validateInputs({ scoreA: null }));
  assert.throws(() => samplingModel.validateInputs({ count: null }));
  const rows = probabilityRows(
    normalizeLogits([1, 2, 3, 4, 5, 6, 7]),
    ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    3,
  );
  assert.deepEqual(
    rows.map((row) => row.indices),
    [[6], [5], [4, 3, 2, 1, 0]],
  );
  close(
    rows.reduce((total, row) => total + row.probability, 0),
    1,
  );
});
test('Wilson includes boundary uncertainty and states a repeated-sampling confidence level', () => {
  const zero = wilsonInterval(0, 10),
    all = wilsonInterval(10, 10),
    half = wilsonInterval(50, 100);
  assert.equal(zero.low, 0);
  close(zero.high, 0.2775327998628892);
  assert.equal(all.high, 1);
  close(all.low, 1 - zero.high);
  close(half.low, 0.4038315303659956);
  close(half.high, 0.5961684696340044);
  assert.equal(half.confidence, 0.95);
  assert.equal(half.method, 'wilson');
  assert.throws(() => wilsonInterval(0, 0));
  assert.throws(() => wilsonInterval(11, 10));
});
test('seeded synthetic samples preserve prefix, raw draws, estimate and exact extremes', () => {
  const a = sampleBernoulli(0.4, 20, 0),
    b = sampleBernoulli(0.4, 100, 0),
    c = sampleBernoulli(0.4, 20, 1);
  assert.deepEqual(a.draws, b.draws.slice(0, 20));
  assert.notDeepEqual(a.draws, c.draws);
  assert.equal(a.successes, a.draws.filter((draw) => draw.value < 0.4).length);
  assert.equal(a.estimate, a.successes / 20);
  assert.equal(sampleBernoulli(0, 100, 42).successes, 0);
  assert.equal(sampleBernoulli(1, 100, 42).successes, 100);
  assert.deepEqual(binomialPrefix(a, 0), {
    count: 0,
    successes: 0,
    estimate: null,
    interval: null,
    draws: [],
  });
  const prefix = binomialPrefix(b, 20);
  assert.equal(prefix.estimate, a.estimate);
  assert.deepEqual(prefix.interval, a.interval);
  assert.throws(() => binomialPrefix(a, 21));
  assert.throws(() => sampleBernoulli(0.5, 3, -1));
  assert.throws(() => sampleBernoulli(1.01, 3, 42));
});
