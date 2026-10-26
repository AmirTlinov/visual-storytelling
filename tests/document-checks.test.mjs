import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareStoryDocument } from '../dist/story/document.js';
import { illustratedPreparation } from '../dist/story/illustrated-preparation.js';

test('boundary proofs retain their actual model, views, operation and clock dependencies', () => {
  for (const recipe of ['division', 'fractions', 'dependency-route']) {
    const inputs =
      recipe === 'division'
        ? { count: 31, divisor: 6 }
        : recipe === 'fractions'
          ? { leftNumerator: 2, leftDenominator: 6, rightNumerator: 3, rightDenominator: 6 }
          : { orderId: 'proof-13', reserve: 'none' };
    const first = prepareStoryDocument({ recipe, inputs });
    assert.equal(first.checks.execution, 'checked');
    assert(first.checks.evaluated > 1);
    const title = structuredClone(first.document);
    title.title = 'Название без изменения механизма';
    assert.equal(prepareStoryDocument(title).checks.evaluated, 0);
    assert.equal(prepareStoryDocument(title).checks.execution, 'reused');
    const retimed = structuredClone(title);
    retimed.chapters[0].beats[0].seconds += 0.3;
    assert.equal(prepareStoryDocument(retimed).checks.execution, 'checked');
    const changed = structuredClone(retimed);
    const values = changed.models[0].inputs;
    if (recipe === 'division') values.count = 30;
    else if (recipe === 'fractions') values.leftNumerator = 1;
    else values.orderId = 'proof-14';
    assert.equal(prepareStoryDocument(changed).checks.execution, 'checked');
    assert.throws(() => prepareStoryDocument({ ...title, resources: [{ id: 'bad' }] }));
    changed.chapters[0].beats[0].operation = { model: changed.models[0].id, name: 'missing' };
    assert.throws(() => prepareStoryDocument(changed), /operation/);
  }
});

test('opaque models are checked again even when the authored bytes are unchanged', () => {
  let calls = 0,
    broken = false;
  const modules = {
    custom: {
      validateInputs: (value) => value,
      validateViews() {},
      focusTargets: () => [],
      operations: {},
      state(values) {
        calls++;
        if (broken) throw Error('External calculation changed');
        return values;
      },
    },
  };
  const document = {
    version: 2,
    models: [{ id: 'm', module: 'custom', inputs: { n: 3 } }],
    views: [],
    chapters: [],
  };
  assert.equal(prepareStoryDocument(document, { modules }).checks.execution, 'opaque');
  prepareStoryDocument(document, { modules });
  assert.equal(calls, 2);
  broken = true;
  assert.throws(() => prepareStoryDocument(document, { modules }), /External calculation/);
});

test('drawing proofs expire on accepted viewer input, layout, narrative text and failed validation', () => {
  const document = prepareStoryDocument({
    recipe: 'division',
    inputs: { count: 27, divisor: 4 },
  }).document;
  const model = document.models[0];
  let current,
    calls = 0,
    broken = false;
  const shell = { parameters: model.inputs, layout: { width: 960, height: 540, scale: 1 } };
  const drawing = {
    validate() {
      calls++;
      if (broken) throw Error('Cannot fit');
    },
  };
  const owner = illustratedPreparation({
    model,
    module: { validateInputs: (value) => value },
    options: { document },
    shell,
    drawing,
    document: () => document,
    presented: () => current,
  });
  owner.prepare(document);
  owner.prepare(document);
  assert.equal(calls, 1);
  assert.equal(owner.checks.drawing.reused, 1);
  current = { values: { ...model.inputs, count: 26 } };
  owner.prepare(document);
  assert.equal(calls, 2);
  shell.layout.width = 480;
  broken = true;
  assert.throws(() => owner.prepare(document), /Cannot fit/);
  assert.throws(() => owner.prepare(document), /Cannot fit/);
  broken = false;
  owner.prepare(document);
  const changed = structuredClone(document);
  changed.chapters[0].beats[0].text = 'Теперь видна причина.';
  owner.prepare(changed);
  assert.equal(calls, 6);
  changed.chapters[0].beats[0].say = 'Другая озвучка того же рисунка.';
  changed.chapters[0].beats[0].seconds += 0.5;
  owner.prepare(changed);
  assert.equal(calls, 6, 'Voice wording and timing do not invalidate an unchanged drawing proof');
});
