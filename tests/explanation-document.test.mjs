import test from 'node:test';
import assert from 'node:assert/strict';
import { validateExplanation, editExplanation } from '../dist/explanation/document.js';

const source = {
  version: 1,
  model: { id: 'division', kind: 'division', count: 17, divisor: 5 },
  views: [{ id: 'objects', kind: 'groups', model: 'division' }],
};
test('subject-only input normalizes to one complete document with stable collision-free default views', () => {
  const input = { model: { kind: 'division', count: 17, divisor: 5 } };
  const before = structuredClone(input);
  const complete = validateExplanation(input);
  assert.deepEqual(complete, {
    version: 1,
    model: { id: 'division', kind: 'division', count: 17, divisor: 5 },
    views: [
      { id: 'groups', kind: 'groups', model: 'division' },
      { id: 'equation', kind: 'equation', model: 'division' },
    ],
  });
  assert.deepEqual(input, before);
  assert.deepEqual(validateExplanation(complete), complete, 'normalization is idempotent');
  assert.deepEqual(
    validateExplanation({ model: { ...input.model, count: 0, divisor: 12 } }).views,
    complete.views,
  );
  for (const modelId of ['groups', 'equation', 'groups.view', 'equation.view', 'm'.repeat(80)]) {
    const document = validateExplanation({ model: { ...input.model, id: modelId } });
    assert.equal(document.model.id, modelId);
    assert.equal(new Set([modelId, ...document.views.map((view) => view.id)]).size, 3);
    assert.ok(document.views.every((view) => view.model === modelId && view.id.length <= 80));
    assert.deepEqual(validateExplanation(document), document);
  }
});

test('structural defaults never guess partial numeric inputs or replace explicit authoring', () => {
  for (const model of [
    { kind: 'division' },
    { kind: 'division', count: 17 },
    { kind: 'division', divisor: 5 },
    { kind: 'division', count: null, divisor: 5 },
  ])
    assert.throws(() => validateExplanation({ model }), /model\.(count|divisor)/);
  const full = {
    ...source,
    title: 'Собственный пример',
    score: [{ id: 'collect', action: 'group', seconds: 3 }],
  };
  assert.deepEqual(validateExplanation(full), full);
  for (const patch of [{ version: 2 }, { version: null }, { views: [] }, { views: null }])
    assert.throws(() => validateExplanation({ ...full, ...patch }), /version|views/);
  assert.throws(
    () => validateExplanation({ model: { kind: 'division', count: 17, divisor: 5, id: null } }),
    /model.id/,
  );
});
test('a compact explanation validates identity, references and textless actions before publication', () => {
  const checked = validateExplanation({
    ...source,
    score: [
      { id: 'collect', action: 'group' },
      { id: 'notice', focus: ['remainder'], hold: true },
    ],
  });
  assert.equal(checked.title, undefined);
  assert.equal(checked.score[0].text, undefined);
  assert.throws(
    () => validateExplanation({ ...source, model: { ...source.model, divisor: 0 } }),
    /model.divisor/,
  );
  assert.throws(
    () =>
      validateExplanation({
        ...source,
        views: [{ id: 'objects', kind: 'groups', model: 'absent' }],
      }),
    /unknown model/,
  );
  assert.throws(
    () => validateExplanation({ ...source, score: [{ id: 'early', action: 'remainder' }] }),
    /before naming/,
  );
  assert.throws(
    () => validateExplanation({ ...source, score: [{ id: 'collect', focus: ['equation'] }] }),
    /view is absent/,
  );
  assert.throws(
    () => validateExplanation({ ...source, score: [{ id: 'division', action: 'group' }] }),
    /duplicate ID/,
  );
  assert.throws(
    () => validateExplanation({ ...source, model: { ...source.model, count: 37 } }),
    /drawing supports/,
  );
});
test('semantic operations produce a new whole candidate and leave the accepted source intact on failure', () => {
  const before = structuredClone(source);
  for (const op of ['set-views', 'set-score']) {
    assert.throws(() => editExplanation(source, [{ op }]), /supply a complete list/);
    assert.deepEqual(source, before);
  }
  const next = editExplanation(source, [
    { op: 'set-inputs', modelId: 'division', values: { count: 20 } },
  ]);
  assert.equal(next.model.count, 20);
  assert.deepEqual(source, before);
  assert.throws(
    () =>
      editExplanation(source, [
        { op: 'set-inputs', modelId: 'division', values: { count: 20 } },
        { op: 'set-inputs', modelId: 'division', values: { divisor: 0 } },
      ]),
    /model.divisor/,
  );
  assert.deepEqual(source, before);
  assert.throws(
    () => editExplanation(source, [{ op: 'set-inputs', modelId: 'other', values: { count: 20 } }]),
    /unknown model/,
  );
  assert.throws(
    () =>
      editExplanation(source, [
        { op: 'set-inputs', modelId: 'division', values: { numerator: 20 } },
      ]),
    /unknown field/,
  );
});

test('one atomic batch can remove a representation and its references in either order', () => {
  const document = validateExplanation({
    model: { kind: 'division', count: 17, divisor: 5 },
    score: [{ id: 'compare', action: 'group', focus: ['equation'] }],
  });
  const operations = [
    { op: 'set-views', views: document.views.filter((view) => view.kind === 'groups') },
    { op: 'set-score', score: [{ id: 'compare', action: 'group', focus: ['groups'] }] },
  ];
  assert.throws(() => editExplanation(document, [operations[0]]), /view is absent/);
  const next = editExplanation(document, operations);
  assert.deepEqual(editExplanation(document, [...operations].reverse()), next);
  assert.equal(next.views.length, 1);
  assert.deepEqual(document.score[0].focus, ['equation']);
});

test('a later replacement cannot conceal a malformed operation in the same batch', () => {
  const replacements = [
    { op: 'set-inputs', modelId: 'division', values: { count: 15 } },
    { op: 'set-score', score: [{ id: 'gather', action: 'group' }] },
    { op: 'set-views', views: source.views },
  ];
  for (const operation of [
    { op: 'set-inputs', modelId: 'division', values: { count: 'oops' } },
    { op: 'set-inputs', modelId: 'division', values: { count: 37 } },
    { op: 'set-score', score: [null] },
    { op: 'set-score', score: [{ id: 'coerced', action: ['group'] }] },
    { op: 'set-score', score: [{ id: 'empty' }] },
    { op: 'set-score', score: [{ id: 'NOT ID', action: 'group' }] },
    { op: 'set-views', views: [{ id: 'invalid', kind: 'unknown', model: 'division' }] },
  ])
    assert.throws(() => editExplanation(source, [operation, ...replacements]));
});
