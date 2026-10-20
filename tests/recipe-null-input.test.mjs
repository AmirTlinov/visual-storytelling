import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareIllustratedDocument } from '../dist/story/document.js';

const recipes = [
  { recipe: 'lever', inputs: { leftForce: 4, leftArm: 30, rightForce: 3, rightArm: 20 } },
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
  { recipe: 'circuit', inputs: { closed: false } },
];
test('explicit null optional recipe fields fail before becoming a different valid story', () => {
  for (const input of recipes) {
    // Use each owner's valid normalized defaults before testing its transport fields.
    const baseline = prepareIllustratedDocument(input).document;
    assert.ok(baseline.chapters.length, input.recipe);
    for (const field of [
      'id',
      'title',
      'chapters',
      ...(['division', 'fractions', 'dependency-route', 'circuit'].includes(input.recipe)
        ? ['views']
        : []),
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

test('generated chapter and qualified beat IDs avoid every model and view identity', () => {
  for (const input of recipes) {
    const baseline = prepareIllustratedDocument(input).document;
    const chapter = baseline.chapters[0];
    for (const collision of [
      chapter.id,
      ...chapter.beats.map((beat) => `${chapter.id}.${beat.id}`),
    ]) {
      const document = prepareIllustratedDocument({ ...input, id: collision }).document;
      assert.equal(document.models[0].id, collision);
      assert.notEqual(document.chapters[0].id, chapter.id, `${input.recipe}: ${collision}`);
      if (['division', 'fractions', 'dependency-route', 'circuit'].includes(input.recipe)) {
        const views = baseline.views.map((view, index) => ({
          ...view,
          id: index ? view.id : collision,
        }));
        const withView = prepareIllustratedDocument({ ...input, views }).document;
        assert.equal(withView.views[0].id, collision);
        assert.notEqual(withView.chapters[0].id, chapter.id, `${input.recipe} view: ${collision}`);
      }
    }
    // Explicit authored identities belong to the author and must still fail on collision.
    assert.throws(() =>
      prepareIllustratedDocument({
        ...input,
        id: `${chapter.id}.${chapter.beats[0].id}`,
        chapters: baseline.chapters,
      }),
    );
  }
});

test('model enum inputs reject null and coercible arrays without changing the selected case', () => {
  for (const [input, field, valid] of [
    [recipes.find((item) => item.recipe === 'fractions'), 'action', 'copy'],
    [recipes.find((item) => item.recipe === 'dependency-route'), 'reserve', 'shared'],
    [
      {
        recipe: 'comparison',
        kind: 'dependency-route',
        inputs: { orderId: '417', reserve: 'none' },
        changes: { reserve: 'independent' },
      },
      'reserve',
      'shared',
    ],
    [
      {
        recipe: 'comparison',
        kind: 'dependency-route',
        inputs: { orderId: '417', reserve: 'none' },
        changes: { reserve: 'independent' },
      },
      'comparisonValue',
      'independent',
    ],
    [recipes.find((item) => item.recipe === 'comparison'), 'comparisonCase', 'after'],
    [recipes.find((item) => item.recipe === 'comparison'), 'comparisonChange', 'rightForce'],
  ]) {
    const document = prepareIllustratedDocument(input).document;
    for (const value of [null, [valid], {}, true, 0, '']) {
      assert.throws(
        () =>
          prepareIllustratedDocument({
            ...document,
            models: [
              { ...document.models[0], inputs: { ...document.models[0].inputs, [field]: value } },
            ],
          }),
        undefined,
        `${field}: ${JSON.stringify(value)}`,
      );
    }
  }
});
