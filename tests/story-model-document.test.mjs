import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
const compiled = await build({
  entryPoints: ['src/story/document.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const {
  validateStoryDocument,
  prepareStoryDocument,
  prepareIllustratedDocument,
  editStoryDocument,
  documentTimeline,
  documentModelsAt,
  authoredInputKeys,
} = await import(
  'data:text/javascript;base64,' +
    Buffer.from(
      compiled.outputFiles[0].text + '\n//# sourceURL=story-model-under-test.mjs',
    ).toString('base64')
);
const cues = await build({
  entryPoints: ['src/story/cues.ts'],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
});
const { cueSheet } = await import(
  'data:text/javascript;base64,' + Buffer.from(cues.outputFiles[0].text).toString('base64')
);
const input = { recipe: 'division', inputs: { count: 17, divisor: 5 } };
const chapter = (beats) => [{ id: 'experience', title: 'Деление', beats }];
const group = { id: 'collect', operation: { model: 'division', name: 'group' }, seconds: 4 };

test('compact division normalizes once to v2 with stable IDs and the accepted eight-second sequence', () => {
  const before = structuredClone(input);
  const doc = validateStoryDocument(input);
  assert.equal(doc.version, 2);
  assert.deepEqual(doc.models, [
    { id: 'division', module: 'division', inputs: { count: 17, divisor: 5 } },
  ]);
  assert.deepEqual(
    doc.views.map((v) => v.id),
    ['groups', 'equation'],
  );
  assert.equal(documentTimeline(doc).duration, 8);
  assert.deepEqual(validateStoryDocument(doc), doc);
  assert.deepEqual(input, before);
  for (const id of [
    'groups',
    'equation',
    'groups.view',
    'equation.view',
    'experience',
    'm'.repeat(80),
  ]) {
    const next = validateStoryDocument({ ...input, id });
    assert.equal(new Set([id, ...next.views.map((v) => v.id)]).size, 3);
    assert.deepEqual(validateStoryDocument(next), next);
  }
});

test('static documents have no timeline and preserve exact division through the same model', () => {
  const doc = validateStoryDocument({ ...input, chapters: [] });
  assert.equal(documentTimeline(doc), undefined);
  const { parts, ...values } = documentModelsAt(doc).models.division;
  assert.deepEqual(values, { count: 17, divisor: 5, progress: 1 });
  assert.equal(parts.length, 17);
  assert.equal(new Set(parts.map((part) => part.id)).size, 17);
  for (const inputs of [
    { count: 0, divisor: 12 },
    { count: 36, divisor: 1 },
    { count: 2, divisor: 5 },
  ])
    assert.deepEqual(validateStoryDocument({ ...input, inputs }).models[0].inputs, inputs);
  for (const inputs of [
    { count: 17 },
    { divisor: 5 },
    { count: null, divisor: 5 },
    { count: 37, divisor: 5 },
    { count: 17, divisor: 0 },
  ])
    assert.throws(() => validateStoryDocument({ ...input, inputs }));
  assert.throws(() =>
    validateStoryDocument({ version: 1, model: { kind: 'division', count: 17, divisor: 5 } }),
  );
  for (const patch of [{ id: null }, { views: null }, { chapters: null }])
    assert.throws(() => validateStoryDocument({ ...input, ...patch }));
});

test('identity, focus and ordinary operation references are validated before publication', () => {
  const doc = validateStoryDocument(input);
  assert.throws(
    () =>
      validateStoryDocument({
        ...doc,
        views: [{ id: 'objects', kind: 'groups', model: 'absent' }],
      }),
    /unknown model/,
  );
  assert.throws(
    () =>
      validateStoryDocument({
        ...doc,
        chapters: chapter([{ ...group, operation: { model: 'division', name: 'remainder' } }]),
      }),
    /before naming/,
  );
  assert.throws(
    () => validateStoryDocument({ ...doc, chapters: chapter([{ ...group, focus: ['absent'] }]) }),
    /unknown target/,
  );
  assert.throws(
    () =>
      validateStoryDocument({
        ...doc,
        chapters: chapter([{ ...group, operation: { model: 'division', name: 'eval' } }]),
      }),
    /unknown operation/,
  );
  assert.throws(
    () => validateStoryDocument({ ...doc, chapters: chapter([group, group]) }),
    /duplicate ID/,
  );
});

test('semantic edits validate a complete candidate without mutating accepted input', () => {
  const doc = validateStoryDocument(input),
    before = structuredClone(doc);
  const next = editStoryDocument(doc, [
    { op: 'set-inputs', modelId: 'division', values: { count: 20 } },
  ]);
  assert.equal(next.models[0].inputs.count, 20);
  assert.deepEqual(doc, before);
  assert.throws(() =>
    editStoryDocument(doc, [
      { op: 'set-inputs', modelId: 'division', values: { count: 20 } },
      { op: 'set-inputs', modelId: 'division', values: { divisor: 0 } },
    ]),
  );
  assert.deepEqual(doc, before);
  for (const operation of [
    { op: 'set-views' },
    { op: 'set-chapters' },
    { op: 'set-inputs', modelId: 'absent', values: { count: 2 } },
    { op: 'set-inputs', modelId: 'division', values: { unknown: 2 } },
  ])
    assert.throws(() => editStoryDocument(doc, [operation]));
});

test('an atomic batch removes a view and its focus in either order, without hiding malformed changes', () => {
  const doc = validateStoryDocument({
    ...input,
    chapters: chapter([{ ...group, focus: ['equation'] }]),
  });
  const operations = [
    { op: 'set-views', views: doc.views.filter((v) => v.kind === 'groups') },
    { op: 'set-chapters', chapters: chapter([{ ...group, focus: ['groups'] }]) },
  ];
  assert.throws(() => editStoryDocument(doc, [operations[0]]), /unknown target/);
  const next = editStoryDocument(doc, operations);
  assert.deepEqual(editStoryDocument(doc, [...operations].reverse()), next);
  for (const operation of [
    { op: 'set-inputs', modelId: 'division', values: { count: 'oops' } },
    { op: 'set-chapters', chapters: chapter([null]) },
    { op: 'set-chapters', chapters: chapter([{ ...group, action: ['group'] }]) },
    { op: 'set-chapters', chapters: chapter([{ ...group, id: 'NOT ID' }]) },
    { op: 'set-views', views: [{ id: 'invalid', kind: 'unknown', model: 'division' }] },
  ])
    assert.throws(() => editStoryDocument(doc, [operation, ...operations]));
});

test('absolute operation replay seeks backwards across division and circuit without accumulating state', () => {
  const doc = validateStoryDocument(input),
    sheet = cueSheet(documentTimeline(doc));
  assert.equal(documentModelsAt(doc, sheet.at(8)).models.division.progress, 1);
  assert.equal(documentModelsAt(doc, sheet.at(0)).models.division.progress, 0);
  assert.ok(documentModelsAt(doc, sheet.at(3)).models.division.progress > 0);
  const circuit = validateStoryDocument({
    version: 2,
    models: [{ id: 'power', module: 'circuit', inputs: { closed: true } }],
    views: [{ id: 'wires', kind: 'circuit', model: 'power' }],
    chapters: [
      {
        id: 'room',
        title: 'Цепь',
        beats: [
          { id: 'open', operation: { model: 'power', name: 'open' }, seconds: 2 },
          { id: 'close', operation: { model: 'power', name: 'close' }, seconds: 2 },
        ],
      },
    ],
  });
  const circuitSheet = cueSheet(documentTimeline(circuit));
  assert.equal(documentModelsAt(circuit, circuitSheet.at(3)).models.power.closed, true);
  assert.equal(documentModelsAt(circuit, circuitSheet.at(1)).models.power.closed, false);
  assert.equal(documentModelsAt(circuit, circuitSheet.at(3)).models.power.closed, true);
});

test('an ordinary JS module adds its own inputs, validation and operations without another document schema', () => {
  const modules = {
    counter: {
      validateInputs(input) {
        assert.equal(typeof input.value, 'number');
        return { ...input };
      },
      state: (input) => ({ ...input }),
      operations: { double: (state) => ({ ...state, value: state.value * 2 }) },
      validateViews() {},
      focusTargets: () => [],
    },
  };
  const doc = validateStoryDocument(
    {
      version: 2,
      models: [
        { id: 'a', module: 'counter', inputs: { value: 3 } },
        { id: 'b', module: 'counter', inputs: { value: 4 } },
      ],
      chapters: [
        {
          id: 'math',
          title: 'Числа',
          beats: [{ id: 'double', operation: { model: 'a', name: 'double' }, seconds: 1 }],
        },
      ],
    },
    { modules },
  );
  const sheet = cueSheet(documentTimeline(doc, undefined, { modules }));
  assert.deepEqual(documentModelsAt(doc, sheet.at(1), {}, modules).models, {
    a: { value: 6 },
    b: { value: 4 },
  });
  assert.deepEqual(authoredInputKeys(doc, 'a', { value: 6 }), ['a.value']);
  assert.deepEqual(authoredInputKeys(validateStoryDocument(input), 'division', { count: 20 }), [
    'count',
  ]);
  assert.throws(() => validateStoryDocument(doc), /unregistered/);
});

test('publication prepares timing and rejects unsupported prepared surfaces before mounting', () => {
  assert.equal(prepareIllustratedDocument(input).script.duration, 8);
  assert.equal(prepareIllustratedDocument({ ...input, chapters: [] }).script, undefined);
  const empty = { version: 2, models: [], views: [], chapters: [] };
  assert.deepEqual(prepareStoryDocument(empty).document, empty);
  assert.throws(() => prepareIllustratedDocument(empty), /chapter factories/);
  const many = validateStoryDocument(input);
  many.models.push({ id: 'second', module: 'division', inputs: { count: 4, divisor: 2 } });
  many.views.push({ id: 'second-view', kind: 'groups', model: 'second' });
  assert.doesNotThrow(() => prepareStoryDocument(many));
  assert.throws(() => prepareIllustratedDocument(many), /chapter factories/);
  for (const timing of [
    { until: 'collect' },
    { until: 'notice', delay: 99 },
    { until: 'later.end' },
  ]) {
    const document = validateStoryDocument(input);
    document.chapters = [
      ...chapter([
        { ...group, timing },
        { id: 'notice', seconds: 1 },
      ]),
      { id: 'later', title: 'Позже', beats: [{ id: 'end', seconds: 1 }] },
    ];
    assert.throws(() => prepareStoryDocument(document));
  }
});
