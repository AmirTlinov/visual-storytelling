import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStoryDocument, editStoryDocument } from '../dist/story/index.js';
const source = {
  id: 'source',
  title: 'Наблюдения',
  kind: 'data',
  description: '20 наблюдений',
  limits: ['Одна выборка'],
  url: 'https://example.org/data',
};
const document = () => ({
  ...validateStoryDocument({ recipe: 'division', inputs: { count: 17, divisor: 5 } }),
  resources: [source],
});
test('document resource refs, identity, kinds and links are checked atomically', () => {
  const doc = document();
  doc.models[0].resources = ['source'];
  const accepted = validateStoryDocument(doc);
  assert.deepEqual(accepted.resources, [source]);
  assert.deepEqual(accepted.models[0].resources, ['source']);
  assert.throws(() => validateStoryDocument({ ...doc, resources: [] }));
  assert.throws(
    () =>
      validateStoryDocument({ ...document(), resources: [{ ...source, id: doc.models[0].id }] }),
    /duplicate/,
  );
  assert.throws(() =>
    validateStoryDocument({ ...doc, resources: [{ ...source, url: 'javascript:alert(1)' }] }),
  );
  assert.throws(() =>
    validateStoryDocument({ ...doc, resources: [{ ...source, kind: { toString: () => 'data' } }] }),
  );
  assert.throws(() => validateStoryDocument({ ...doc, resources: [, source] }), /dense/);
  assert.throws(
    () => editStoryDocument(doc, [{ op: 'set-resources', resources: [] }]),
    /reference/,
  );
  const updated = editStoryDocument(doc, [
    { op: 'set-resources', resources: [{ ...source, description: 'Другая выборка' }] },
  ]);
  assert.equal(updated.resources[0].description, 'Другая выборка');
  assert.equal(doc.resources[0].description, '20 наблюдений');
  const collision = validateStoryDocument({
    recipe: 'probability',
    id: 'probability-source',
    inputs: {},
    resources: [source],
  });
  assert.equal(collision.models[0].id, 'probability-source');
  assert.equal(collision.resources.length, 3);
  assert.equal(
    new Set([...collision.resources.map((resource) => resource.id), collision.models[0].id]).size,
    4,
  );
  for (const [recipe, id] of [
    ['probability', 'derive.scores'],
    ['sampling', 'derive.sample'],
  ]) {
    const result = validateStoryDocument({
      recipe,
      id,
      inputs: {},
      resources: [{ ...source, id: 'distribution' }],
    });
    assert.equal(result.models[0].id, id);
    assert.notEqual(result.views[0].id, 'distribution');
    assert.notEqual(result.chapters[0].id, 'derive');
  }
});
