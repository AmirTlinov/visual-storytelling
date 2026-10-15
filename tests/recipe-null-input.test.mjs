import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareIllustratedDocument } from '../dist/story/document.js';

const recipes = [
  { recipe: 'division', inputs: { count: 17, divisor: 4 } },
  {
    recipe: 'fractions',
    inputs: {
      leftNumerator: 1,
      leftDenominator: 2,
      rightNumerator: 1,
      rightDenominator: 3,
      action: 'move',
    },
  },
  { recipe: 'dependency-route', inputs: { orderId: '417', reserve: 'none' } },
  {
    recipe: 'comparison',
    kind: 'lever',
    inputs: { leftForce: 3, leftArm: 2, rightForce: 2, rightArm: 3 },
    changes: { rightForce: 4 },
  },
  { recipe: 'probability', inputs: { scoreA: 1, scoreB: 2, scoreC: 3 } },
  { recipe: 'sampling', inputs: { percent: 50, count: 10, seed: 42 } },
];
test('explicit null optional recipe fields fail before becoming a different valid story', () => {
  for (const input of recipes) {
    // Use each owner's valid normalized defaults before testing its transport fields.
    const baseline = prepareIllustratedDocument(input).document;
    assert.ok(baseline.chapters.length, input.recipe);
    for (const field of [
      'id',
      'chapters',
      ...(['division', 'fractions', 'dependency-route'].includes(input.recipe) ? ['views'] : []),
    ])
      assert.throws(
        () => prepareIllustratedDocument({ ...input, [field]: null }),
        undefined,
        `${input.recipe}.${field}`,
      );
    assert.equal(
      prepareIllustratedDocument({ ...input, chapters: [] }).document.chapters.length,
      0,
    );
  }
});
