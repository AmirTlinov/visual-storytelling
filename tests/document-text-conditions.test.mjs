import test from 'node:test';
import assert from 'node:assert/strict';
import {
  divisionState,
  documentSpeechPreparation,
  validateStoryDocument,
  prepareStoryDocument,
  documentModelsAt,
  cueSheet,
  editStoryDocument,
  captionTrack,
} from '../dist/index.js';
import { documentCanContinue } from '../dist/story/document-model.js';
const source = {
  recipe: 'division',
  inputs: { count: 17, divisor: 4 },
  chapters: [
    {
      id: 'lesson',
      title: 'Соберём группы',
      beats: [
        {
          id: 'group',
          operation: { model: 'division', name: 'group' },
          seconds: 2,
          text: 'Один остаётся вне групп.',
        },
      ],
    },
  ],
};
function at(doc, inputs, mode = 'story') {
  const { script } = prepareStoryDocument(doc);
  return documentModelsAt(
    doc,
    cueSheet(script).at(script.duration),
    { division: inputs },
    {},
    { mode },
  );
}
test('counterfactuals keep computed facts while withholding the original authored claim', () => {
  const doc = validateStoryDocument(source),
    saved = structuredClone(doc);
  assert.equal(at(doc, doc.models[0].inputs).beat.text, source.chapters[0].beats[0].text);
  const changed = at(doc, { count: 20, divisor: 4 }, 'explore');
  assert.equal(
    divisionState(changed.models.division.count, changed.models.division.divisor).remainder,
    0,
  );
  assert.equal(changed.beat.text, undefined);
  assert.equal(changed.beat.operation.name, 'group');
  assert.deepEqual(doc, saved);
  const edited = editStoryDocument(doc, [
    { op: 'set-inputs', modelId: 'division', values: { count: 20 } },
  ]);
  assert.equal(at(edited, edited.models[0].inputs).beat.text, undefined);
  assert.equal(edited.chapters[0].beats[0].text, source.chapters[0].beats[0].text);
  const { script } = prepareStoryDocument(edited);
  assert.equal(captionTrack(script).at(1), '');
  assert(!captionTrack(script).serialize('srt').includes('Один остаётся'));
});

test('caption groups retain their own meaning even when reading time extends past their source words', () => {
  const a = {
    id: 'a',
    start: 0,
    end: 1,
    text: 'Первое утверждение.',
    conditions: { basis: 'presented', models: [] },
  };
  const b = { id: 'b', start: 2, end: 3, text: 'Другое утверждение.' };
  const track = captionTrack({ segments: [a, b] });
  assert.equal(
    track.at(0.5, (unit) => unit === a),
    a.text,
  );
  assert.equal(
    track.at(0.5, (unit) => unit === b),
    '',
  );
  assert.equal(
    track.at(2.5, (unit) => unit === b),
    b.text,
  );
});

test('a projected caption never replaces the original prediction gate object, including chapter gaps', () => {
  let consulted;
  const owner = {
    validateInputs: (v) => ({ value: Number(v.value) }),
    state: (v) => ({ ...v }),
    operations: {},
    validateViews() {},
    focusTargets: () => [],
    canContinue(_state, beat) {
      consulted = beat;
      return true;
    },
  };
  const modules = { probe: owner };
  const doc = validateStoryDocument(
    {
      version: 2,
      models: [{ id: 'model', module: 'probe', inputs: { value: 1 } }],
      views: [],
      chapters: [
        {
          id: 'first',
          title: 'Первое',
          beats: [{ id: 'predict', text: 'Был один.', seconds: 1, awaitInput: { model: 'model' } }],
        },
        {
          id: 'second',
          title: 'Второе',
          beats: [
            { id: 'predict', text: 'Проверим ещё.', seconds: 1, awaitInput: { model: 'model' } },
          ],
        },
      ],
    },
    { modules },
  );
  const script = prepareStoryDocument(doc, { modules }).script;
  const moment = documentModelsAt(doc, cueSheet(script).at(0.5), { model: { value: 2 } }, modules, {
    mode: 'explore',
    chapter: 'second',
  });
  assert.equal(moment.chapter, 'second');
  assert.equal(moment.beat.text, undefined);
  assert.notEqual(moment.beat, doc.chapters[0].beats[0]);
  assert.equal(documentCanContinue(doc, moment, modules), true);
  assert.equal(consulted, doc.chapters[0].beats[0]);
});
test('declared general and presented-input statements follow their actual dependencies', () => {
  for (const conditions of [
    { basis: 'presented', models: [] },
    { basis: 'presented', models: [{ model: 'division', inputs: { count: 17 } }] },
  ]) {
    const doc = validateStoryDocument(source);
    doc.chapters[0].beats[0].text = 'Сравни условия.';
    doc.chapters[0].beats[0].speech.when = conditions;
    assert.equal(at(doc, { count: 17, divisor: 5 }, 'explore').beat.text, 'Сравни условия.');
    assert.equal(
      at(doc, { count: 20, divisor: 4 }, 'explore').beat.text,
      conditions.models.length ? undefined : 'Сравни условия.',
    );
  }
});
test('a caption explicitly excluded from voice is still conservative after viewer input', () => {
  const doc = validateStoryDocument({
    ...source,
    chapters: [{ ...source.chapters[0], beats: [{ ...source.chapters[0].beats[0], say: '' }] }],
  });
  assert(doc.chapters[0].beats[0].speech);
  assert.deepEqual(documentSpeechPreparation(doc), []);
  const edited = editStoryDocument(doc, [
    { op: 'set-inputs', modelId: 'division', values: { count: 20 } },
  ]);
  assert.equal(at(edited, edited.models[0].inputs).beat.text, undefined);
  assert.equal(at(doc, { count: 20, divisor: 4 }, 'explore').beat.text, undefined);
});

test('pending captions use current authored wording and conditions, and never bless the old take', async () => {
  const { documentCaptionApplicable } = await import('../dist/story/document-conditions.js');
  const { documentSpeechApplicable } = await import('../dist/story/document-audibility.js');
  const doc = validateStoryDocument(source);
  const beat = doc.chapters[0].beats[0];
  beat.text = 'Семнадцать.';
  beat.speech.when = { basis: 'presented', models: [{ model: 'division', inputs: { count: 17 } }] };
  const recording = {
    id: beat.speech.id,
    start: 0,
    end: 2,
    text: 'Посмотрим.',
    conditions: { basis: 'presented', models: [] },
  };
  const pending = { ...recording, displayText: beat.text };
  assert.equal(
    documentCaptionApplicable(doc, pending, 'explore', { division: { count: 17, divisor: 4 } }),
    true,
  );
  assert.equal(
    documentCaptionApplicable(doc, pending, 'explore', { division: { count: 20, divisor: 4 } }),
    false,
  );
  assert.equal(
    documentCaptionApplicable(doc, recording, 'story', { division: { count: 17, divisor: 4 } }),
    false,
  );
  assert.equal(
    documentSpeechApplicable(doc, pending, 'story', { division: { count: 17, divisor: 4 } }),
    false,
  );
});

test('portable conditional captions are reprojected and a changing whole-take model stays conservative', () => {
  const doc = validateStoryDocument(source);
  doc.chapters[0].beats[0].speech.when = {
    basis: 'presented',
    models: [{ model: 'division', inputs: { count: 17 } }],
  };
  const changed = editStoryDocument(doc, [
    { op: 'set-inputs', modelId: 'division', values: { count: 20 } },
  ]);
  assert.equal(captionTrack(prepareStoryDocument(changed).script).serialize('srt'), '\n');
  const original = validateStoryDocument(source);
  const stale = prepareStoryDocument(
    editStoryDocument(original, [{ op: 'set-inputs', modelId: 'division', values: { count: 20 } }]),
  ).script;
  // Raw local timings are a projection, not accepted measured audio; repeat projection uses the same source.
  const restored = prepareStoryDocument(original).script;
  assert.equal(stale.segments[0].captionApplicable, false);
  assert.equal(captionTrack(restored).at(1), source.chapters[0].beats[0].text);
  const circuit = validateStoryDocument({
    recipe: 'circuit',
    inputs: { closed: true },
    chapters: [
      {
        id: 'experiment',
        title: 'Проверим контакт',
        beats: [
          {
            id: 'first',
            text: 'Замкнут.',
            seconds: 2,
            speech: {
              id: 'voice.thought',
              when: {
                basis: 'presented',
                models: [{ model: 'circuit', inputs: { closed: true } }],
              },
            },
          },
          {
            id: 'second',
            text: 'Ещё замкнут.',
            seconds: 2,
            operation: { model: 'circuit', name: 'open' },
            speech: {
              id: 'voice.thought',
              when: {
                basis: 'presented',
                models: [{ model: 'circuit', inputs: { closed: true } }],
              },
            },
          },
        ],
      },
    ],
  });
  const script = prepareStoryDocument(circuit).script;
  assert.equal(script.segments[1].captionApplicable, false);
  assert(!captionTrack(script).serialize('srt').includes('Ещё замкнут.'));
});

test('a grouped recorded thought cannot export a conditional claim across its own changed model', () => {
  const when = { basis: 'presented', models: [{ model: 'circuit', inputs: { closed: true } }] };
  const doc = validateStoryDocument({
    recipe: 'circuit',
    inputs: { closed: true },
    chapters: [
      {
        id: 'lesson',
        title: 'Контур',
        beats: [
          { id: 'a', text: 'Лампа горит.', speech: { id: 'voice.thought', when } },
          {
            id: 'b',
            text: 'Контур замкнут.',
            operation: { model: 'circuit', name: 'open' },
            speech: { id: 'voice.thought', when },
          },
        ],
      },
    ],
  });
  const aligned = {
    duration: 4,
    cues: { 'lesson.a': { start: 0.1, end: 1.5 }, 'lesson.b': { start: 2, end: 4 } },
    segments: [
      {
        id: 'voice.thought',
        text: 'Лампа горит. Контур замкнут.',
        source_text: 'Лампа горит. Контур замкнут.',
        conditions: when,
        start: 0.1,
        end: 4,
        words: [
          { text: 'Лампа', start: 0.1, end: 0.5 },
          { text: 'горит.', start: 1, end: 1.5 },
          { text: 'Контур', start: 2, end: 2.6 },
          { text: 'замкнут.', start: 3, end: 4 },
        ],
      },
    ],
  };
  const projected = prepareStoryDocument(doc, {}, aligned).script;
  assert.equal(projected.segments[0].captionApplicable, false);
  assert.equal(captionTrack(projected).serialize('srt'), '\n');
  const roundtrip = JSON.parse(JSON.stringify(projected));
  doc.chapters[0].beats[0].speech.when = { basis: 'presented', models: [] };
  doc.chapters[0].beats[1].speech.when = { basis: 'presented', models: [] };
  const restored = prepareStoryDocument(doc, {}, roundtrip).script;
  assert.equal(restored.segments[0].captionApplicable, true);
  assert(captionTrack(restored).serialize('srt').includes('Контур'));
});
