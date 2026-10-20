import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  validateStoryDocument,
  documentTimeline,
  documentModelsAt,
  editStoryDocument,
} from '../dist/story/document.js';
import { documentCanContinue } from '../dist/story/document-model.js';
import { cueSheet } from '../dist/story/cues.js';
import { gptModel } from '../examples/gpt-model/subject-model.js';
import { forward, tokenize } from '../examples/gpt-model/model.js';
import { computationPlan } from '../examples/gpt-model/computation.js';
const source = JSON.parse(
  await readFile(new URL('../examples/gpt-model/story.json', import.meta.url)),
);
const options = { modules: { gpt: gptModel } };

test('the editable GPT document preserves the real changed prompt and tensor origins on every authored representation', () => {
  const doc = editStoryDocument(
    source,
    [
      {
        op: 'set-inputs',
        modelId: 'gpt',
        values: { prompt: 'птица сидит на', token: 2, source: 1, block: 1, head: 1 },
      },
    ],
    options,
  );
  const expected = forward(tokenize('птица сидит на'));
  const script = documentTimeline(doc, undefined, options),
    sheet = cueSheet(script);
  assert.equal(script.duration, 94);
  assert.equal(script.segments.filter((s) => s.title).length, 9);
  for (const chapter of doc.chapters) {
    const state = documentModelsAt(
      doc,
      sheet.at(script.cues[chapter.id].start),
      {},
      options.modules,
    ).models.gpt;
    assert.deepEqual(state.detail.trace, expected);
    assert.equal(state.detail.token, 2);
    assert.deepEqual(state.detail.block, expected.blocks[1]);
    for (const kind of ['score', 'mix', 'residual', 'mlp', 'logit']) {
      const calculation = computationPlan({
        ...state.detail.values,
        trace: state.detail.trace,
        candidate: state.detail.candidate,
        kind,
      });
      for (const [i, value] of [calculation.plan.result].flat().entries())
        assert.ok(Math.abs(value - [calculation.expected].flat()[i]) < 1e-10);
      for (const tensor of Object.values(calculation.inputs))
        for (let i = 0; i < tensor.values.length; i++)
          assert.equal(tensor.origin(i).value, tensor.values[i]);
    }
  }
  assert.equal(source.models[0].inputs.prompt, '');
  assert.throws(
    () =>
      editStoryDocument(
        doc,
        [{ op: 'set-inputs', modelId: 'gpt', values: { prompt: 'внесловарное' } }],
        options,
      ),
    /Unknown|vocabulary|token|словар/i,
  );
  assert.deepEqual(
    documentModelsAt(doc, sheet.at(0), {}, options.modules).models.gpt.detail.trace,
    expected,
  );
});

test('the shared Story gate consults the declared model and an edited episode retains its stable operation IDs', () => {
  const document = validateStoryDocument(source, options);
  const sheet = cueSheet(documentTimeline(document, undefined, options));
  const at = documentModelsAt(document, sheet.at(81), {}, options.modules);
  assert.equal(documentCanContinue(document, at, options.modules), false);
  const accepted = documentModelsAt(
    document,
    sheet.at(81),
    { gpt: { ...document.models[0].inputs, checked: true, guess: 'мяу' } },
    options.modules,
    { mode: 'explore' },
  );
  assert.equal(
    documentCanContinue(document, accepted, options.modules),
    true,
    'a checked wrong attempt releases the barrier',
  );
  const chapters = structuredClone(document.chapters);
  chapters[0].beats[0].seconds += 2;
  const edited = editStoryDocument(document, [{ op: 'set-chapters', chapters }], options);
  const changed = documentTimeline(edited, undefined, options);
  assert.equal(changed.duration, 96);
  assert.deepEqual(Object.keys(changed.cues), Object.keys(sheet.script.cues));
  const malformed = structuredClone(document);
  malformed.chapters[0].beats[0].awaitInput = { model: 'missing' };
  assert.throws(() => validateStoryDocument(malformed, options), /model|awaitInput/);
});

test('declared views and semantic steps survive edited episode and beat IDs', () => {
  const document = validateStoryDocument(source, options);
  const renamed = editStoryDocument(
    document,
    [
      {
        op: 'set-chapters',
        chapters: document.chapters.map((c) => ({
          ...c,
          id: 'lesson-' + c.id,
          beats: c.beats.map((b) => ({ ...b, id: 'action-' + b.id })),
        })),
      },
    ],
    options,
  );
  const sheet = cueSheet(documentTimeline(renamed, undefined, options));
  const embedding = documentModelsAt(renamed, sheet.at(15), {}, options.modules).models.gpt;
  assert.equal(embedding.view, 'embedding');
  assert.equal(embedding.detail.steps['embedding.word'], 1);
  assert.equal(embedding.detail.steps['embedding.position'], 0.5);
  const changed = editStoryDocument(
    document,
    [
      { op: 'set-inputs', modelId: 'gpt', values: { kind: 'mix' } },
      { op: 'set-views', views: document.views.map((v, i) => (i ? v : { ...v, kind: 'mlp' })) },
    ],
    options,
  );
  const changedSheet = cueSheet(documentTimeline(changed, undefined, options));
  assert.equal(
    documentModelsAt(changed, changedSheet.at(0), {}, options.modules).models.gpt.view,
    'mlp',
  );
  const calculation = documentModelsAt(changed, changedSheet.at(47), {}, options.modules).models
    .gpt;
  assert.equal(calculation.view, 'attention');
  assert.equal(calculation.perspective, 'algebra');
  assert.equal(calculation.kind, 'score');
});
