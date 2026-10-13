import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

async function sourceModule(path) {
  const source = await build({
    entryPoints: [path],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
  });
  return import(
    'data:text/javascript;base64,' + Buffer.from(source.outputFiles[0].text).toString('base64')
  );
}
const { validateStoryDocument, normalizeStoryDocument, editStoryDocument, documentNarration } =
  await sourceModule('src/story/document.ts');
const { compileStoryDocument, validateStoryNarration } =
  await sourceModule('src/story/compiler.ts');
const compact = { model: { kind: 'division', count: 17, divisor: 5 } };
const source = normalizeStoryDocument(compact);
const chapter = (beats) => [{ id: 'division', title: 'Деление', beats }];
const group = {
  id: 'collect',
  say: '',
  seconds: 3,
  staging: { model: 'division', operation: 'group' },
};

test('creation normalizes division once; persisted documents are strictly canonical', () => {
  const before = structuredClone(compact);
  assert.deepEqual(source.models, [
    { id: 'division', kind: 'division', inputs: { count: 17, divisor: 5 } },
  ]);
  assert.deepEqual(source.views, [
    { id: 'groups', kind: 'groups', model: 'division' },
    { id: 'equation', kind: 'equation', model: 'division' },
  ]);
  assert.deepEqual(
    source.chapters[0].beats.map((beat) => beat.id),
    ['gather', 'group', 'remainder'],
  );
  assert.deepEqual(compact, before);
  assert.deepEqual(validateStoryDocument(source), source);
  assert.deepEqual(normalizeStoryDocument(source), source);
  assert.throws(() => validateStoryDocument(compact), /unknown field|version/);
  assert.throws(
    () => validateStoryDocument({ title: 'Old story', chapters: source.chapters }),
    /version/,
  );
  assert.throws(() => validateStoryDocument({ ...source, score: [] }), /unknown field/);
  for (const modelId of ['groups', 'equation', 'groups.view', 'equation.view', 'm'.repeat(80)]) {
    const document = normalizeStoryDocument({ model: { ...compact.model, id: modelId } });
    assert.equal(new Set([modelId, ...document.views.map((view) => view.id)]).size, 3);
    assert.ok(document.views.every((view) => view.model === modelId && view.id.length <= 80));
  }
});

test('explicit static documents have no script, cues, duration or speech projection', () => {
  const document = normalizeStoryDocument({ ...compact, chapters: [] });
  const compiled = compileStoryDocument(document);
  assert.deepEqual(compiled.chapters, []);
  assert.equal(compiled.script, undefined);
  assert.deepEqual(documentNarration(document).segments, []);
  assert.throws(
    () => compileStoryDocument(document, { duration: 8, cues: {}, segments: [] }),
    /static document/,
  );
  assert.throws(() => normalizeStoryDocument({ ...compact, chapters: null }), /complete list/);
});

test('division and custom chapter documents share the existing cue compiler', () => {
  const compiled = compileStoryDocument(source);
  assert.equal(compiled.script.duration, 8);
  assert.deepEqual(Object.keys(compiled.script.cues), [
    'division',
    'division.gather',
    'division.group',
    'division.remainder',
  ]);
  assert.deepEqual(compiled.script.cues['division.group'], {
    start: 1.2,
    end: 5.2,
    action: 'group',
  });
  assert.deepEqual(compiled.script.segments, []);
  const custom = {
    version: 1,
    models: [],
    views: [],
    chapters: [
      {
        id: 'room',
        title: 'Комната',
        beats: [
          {
            id: 'press',
            seconds: 2,
            say: '',
            perform: [{ action: 'press', actor: 'hero', target: 'switch' }],
          },
        ],
      },
    ],
  };
  const result = compileStoryDocument(custom);
  assert.equal(result.script.duration, 2);
  assert.deepEqual(result.chapters[0].beats[0].perform, custom.chapters[0].beats[0].perform);
  assert.equal(result.script.cues['room.press'].start, 0);
});

test('validation retains subject constraints, identity, references and grouping order', () => {
  for (const model of [
    { kind: 'division' },
    { kind: 'division', count: 17 },
    { kind: 'division', divisor: 5 },
    { ...compact.model, count: null },
  ])
    assert.throws(() => normalizeStoryDocument({ model }), /model\.(count|divisor)/);
  assert.throws(
    () => normalizeStoryDocument({ model: { ...compact.model, divisor: 0 } }),
    /divisor/,
  );
  assert.throws(
    () => normalizeStoryDocument({ model: { ...compact.model, count: 37 } }),
    /drawing supports/,
  );
  assert.throws(() => validateStoryDocument({ ...source, version: 2 }), /version/);
  assert.throws(
    () =>
      validateStoryDocument({
        ...source,
        views: [{ id: 'groups', kind: 'groups', model: 'absent' }],
      }),
    /unknown model/,
  );
  assert.throws(
    () =>
      validateStoryDocument({
        ...source,
        chapters: chapter([{ ...group, staging: { model: 'division', operation: 'remainder' } }]),
      }),
    /before naming/,
  );
  assert.throws(
    () =>
      validateStoryDocument({
        ...source,
        views: source.views.slice(0, 1),
        chapters: chapter([{ ...group, staging: { ...group.staging, focus: ['equation'] } }]),
      }),
    /view is absent/,
  );
  assert.throws(
    () => validateStoryDocument({ ...source, chapters: chapter([group, group]) }),
    /duplicate ID/,
  );
  assert.throws(
    () =>
      validateStoryDocument({
        ...source,
        chapters: chapter([{ ...group, staging: { model: 'absent', operation: 'group' } }]),
      }),
    /unknown model/,
  );
});

test('semantic operations produce a new whole candidate and preserve source on failure', () => {
  const before = structuredClone(source);
  const next = editStoryDocument(source, [
    { op: 'set-inputs', modelId: 'division', values: { count: 20 } },
  ]);
  assert.equal(next.models[0].inputs.count, 20);
  for (const op of ['set-views', 'set-chapters'])
    assert.throws(() => editStoryDocument(source, [{ op }]), /complete list/);
  assert.throws(
    () => editStoryDocument(source, [{ op: 'set-score', score: [] }]),
    /unknown operation/,
  );
  assert.throws(
    () =>
      editStoryDocument(source, [
        { op: 'set-inputs', modelId: 'division', values: { count: 20 } },
        { op: 'set-inputs', modelId: 'division', values: { divisor: 0 } },
      ]),
    /divisor/,
  );
  assert.throws(
    () =>
      editStoryDocument(source, [{ op: 'set-inputs', modelId: 'other', values: { count: 20 } }]),
    /unknown model/,
  );
  assert.throws(
    () =>
      editStoryDocument(source, [
        { op: 'set-inputs', modelId: 'division', values: { numerator: 20 } },
      ]),
    /unknown field/,
  );
  assert.deepEqual(source, before);
});

test('an atomic batch can remove a representation and its references in either order', () => {
  const document = validateStoryDocument({
    ...source,
    chapters: chapter([{ ...group, staging: { ...group.staging, focus: ['equation'] } }]),
  });
  const operations = [
    { op: 'set-views', views: source.views.slice(0, 1) },
    { op: 'set-chapters', chapters: chapter([group]) },
  ];
  assert.throws(() => editStoryDocument(document, operations.slice(0, 1)), /view is absent/);
  const next = editStoryDocument(document, operations);
  assert.deepEqual(editStoryDocument(document, operations.toReversed()), next);
  assert.equal(next.views.length, 1);
  assert.deepEqual(document.chapters[0].beats[0].staging.focus, ['equation']);
});

test('a later replacement cannot conceal malformed inputs, beat structure or view kinds', () => {
  const replacements = [
    { op: 'set-inputs', modelId: 'division', values: { count: 15 } },
    { op: 'set-chapters', chapters: chapter([group]) },
    { op: 'set-views', views: source.views },
  ];
  for (const operation of [
    { op: 'set-inputs', modelId: 'division', values: { count: 'oops' } },
    { op: 'set-inputs', modelId: 'division', values: { count: 37 } },
    { op: 'set-chapters', chapters: [null] },
    { op: 'set-chapters', chapters: chapter([{ ...group, action: ['group'] }]) },
    {
      op: 'set-chapters',
      chapters: chapter([
        { ...group, staging: { model: 'division', operation: 'not-an-operation' } },
      ]),
    },
    { op: 'set-chapters', chapters: chapter([{ ...group, id: 'NOT ID' }]) },
    { op: 'set-views', views: [{ id: 'invalid', kind: 'unknown', model: 'division' }] },
  ])
    assert.throws(() => editStoryDocument(source, [operation, ...replacements]));
});

test('acoustic reuse compares spoken runs and beat wording, retaining punctuation and delivery intent', () => {
  const voiced = structuredClone(source);
  voiced.chapters[0].beats.forEach((beat, index) => {
    beat.say = ['<|emotion:calm|> Соберём предметы.', 'Разделим их.', 'Остаток виден.'][index];
  });
  const aligned = {
    duration: 8,
    cues: {},
    segments: [
      { id: 'division', start: 0, end: 8, text: 'Соберём предметы. Разделим их. Остаток виден.' },
    ],
  };
  assert.doesNotThrow(() => validateStoryNarration(voiced, aligned));
  const whitespace = structuredClone(voiced);
  whitespace.chapters[0].beats[1].say = '  Разделим   их. ';
  assert.doesNotThrow(() => validateStoryNarration(whitespace, aligned, voiced));
  for (const update of [
    (doc) => (doc.chapters[0].beats[0].say = '<|emotion:angry|> Соберём предметы.'),
    (doc) => (doc.chapters[0].beats[0].say = '<|emotion:calm|> Соберём предметы!'),
    (doc) => (doc.chapters[0].beats[0].say = '<|emotion:calm|> Соберём людей.'),
    (doc) => {
      doc.chapters[0].beats[0].say = '<|emotion:calm|> Соберём';
      doc.chapters[0].beats[1].say = 'предметы. Разделим их.';
    },
    (doc) => (doc.narration = { voice: { seed: 24 } }),
  ]) {
    const next = structuredClone(voiced);
    update(next);
    assert.throws(
      () => validateStoryNarration(next, aligned, voiced),
      /Prepare new audio and acoustic timing/,
    );
  }
  assert.throws(
    () => validateStoryNarration(voiced, { ...aligned, segments: [] }),
    /Prepare new audio and acoustic timing/,
  );
});
