import { documentTimeline } from '../dist/story/document.js';
import { cueSheet } from '../dist/story/cues.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fractionState, fractionInputs, fractionsModel } from '../dist/recipes/fractions-model.js';
import { validateStoryDocument, documentModelsAt } from '../dist/story/document.js';
import { rational, rationalText, addRational, multiplyRational } from '../dist/math/rational.js';
const inputs = { leftNumerator: 1, leftDenominator: 2, rightNumerator: 1, rightDenominator: 3 };
test('every phase retains exact measured quantity and roots; copying has a stable explicit delta', () => {
  for (const progress of [0, 0.01, 0.5, 1, 1.01, 1.5, 2]) {
    const state = fractionState(inputs, progress);
    assert.equal(rationalText(state.result), '5/6');
    assert.equal(rationalText(state.total), '5/6');
    assert.ok(state.parts.every((part) => part.reference === 'same-unit-whole'));
  }
  const copy = fractionState({ ...inputs, action: 'copy' }, 2);
  assert.equal(rationalText(copy.total), '4/3');
  assert.deepEqual(copy.added, rational(1, 2));
  assert.equal(copy.parts.filter((part) => part.container === 'left').length, 3);
  assert.deepEqual(fractionState({ ...inputs, action: 'copy' }, 2), copy);
  assert.equal(rationalText(fractionState({ ...inputs, action: 'copy' }, 0).total), '5/6');
});
test('zero and sums beyond one use bounded fragments; invalid magnitudes and actions fail', () => {
  for (const [a, b, c, d] of [
    [0, 2, 0, 3],
    [0, 2, 1, 3],
    [1, 1, 1, 1],
    [7, 8, 11, 12],
  ]) {
    const state = fractionState(
      { leftNumerator: a, leftDenominator: b, rightNumerator: c, rightDenominator: d },
      2,
    );
    assert.equal(state.parts.length, (a * state.denominator) / b + (c * state.denominator) / d);
    assert.deepEqual(state.total, addRational(rational(a, b), rational(c, d)));
  }
  for (const change of [
    { leftNumerator: -1 },
    { leftNumerator: 3 },
    { rightDenominator: 0 },
    { rightDenominator: 7 },
    { action: 'clone' },
    { unknown: 1 },
  ])
    assert.throws(() => fractionInputs({ ...inputs, ...change }));
  const M = Number.MAX_SAFE_INTEGER;
  assert.deepEqual(addRational(rational(M - 1, M), rational(1, M)), rational(1));
  assert.deepEqual(multiplyRational(rational(M, 2), rational(2, M)), rational(1));
});
test('authored replay is deterministic across backward seek and forbids collect before partition', () => {
  const document = validateStoryDocument({
    recipe: 'fractions',
    inputs: { ...inputs, action: 'copy' },
  });
  const sheet = cueSheet(documentTimeline(document));
  const finished = documentModelsAt(document, sheet.at(6)).models.fractions;
  const initial = documentModelsAt(document, sheet.at(0)).models.fractions;
  assert.equal(rationalText(initial.total), '5/6');
  assert.equal(rationalText(finished.total), '4/3');
  assert.deepEqual(documentModelsAt(document, sheet.at(6)).models.fractions, finished);
  assert.throws(() => fractionsModel.validateSequence(['align', 'collect']));
  assert.throws(() => fractionsModel.validateSequence(['partition', 'finish']), /before holding/);
  for (const operations of [
    ['partition', 'collect', 'partition'],
    ['partition', 'collect', 'align'],
    ['partition', 'collect', 'collect'],
    ['partition', 'finish', 'collect'],
  ])
    assert.throws(() => fractionsModel.validateSequence(operations), /advance once|before holding/);
});
test('document model identity owns every fragment through authored replay and static rendering', () => {
  for (const id of ['pieces', 'equation', 'material']) {
    const document = validateStoryDocument({ recipe: 'fractions', id, inputs });
    const sheet = cueSheet(documentTimeline(document));
    for (const time of [0, 2, 4, 6]) {
      const state = documentModelsAt(document, sheet.at(time)).models[id];
      assert.ok(state.parts.every((part) => part.id.startsWith(`${id}:`)));
      assert.ok(
        state.parts.every((part) => part.origins.every((origin) => origin.id.startsWith(`${id}:`))),
      );
    }
    assert.deepEqual(
      documentModelsAt(validateStoryDocument({ ...document, chapters: [] })).models[id],
      documentModelsAt(document, sheet.at(6)).models[id],
    );
  }
});
