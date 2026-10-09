import test from 'node:test';
import assert from 'node:assert/strict';
import { presentSession } from '../plugin/mcp/presentation.mjs';

const wire = (value) => JSON.parse(JSON.stringify(value));

test('projection remains stable across renderer and tool boundaries without losing requested detail', () => {
  const state = {
    time: 3,
    duration: 8,
    playing: false,
    mode: 'explore',
    objects: Array.from({ length: 23 }, (_, id) => ({
      id: 'object-' + id,
      label: 'Object ' + id,
      value: { x: id },
      inputs: ['source'],
      provenance: { expression: 'x + 1' },
    })),
    review: {
      cues: [{ id: 'move', start: 2, end: 4, action: 'Move the object' }],
      segments: [{ id: 'chapter', words: [{ text: 'Move', start: 2, end: 3 }] }],
    },
    snapshot: { model: 'full model' },
    presentation: { bounds: [0, 0, 100, 100] },
  };
  const compact = presentSession({ state });
  assert.equal(compact.state.objects.length, 20);
  assert.equal(compact.state.moreObjects, 3);
  assert.equal(compact.state.objects[0].value, undefined);
  assert.equal(compact.state.objects[0].provenance, undefined);
  assert.equal(compact.state.cue.id, 'move');
  assert.equal(compact.state.review, undefined);
  const detailed = presentSession({ state }, 'model');
  assert.deepEqual(detailed.state.objects, state.objects);
  assert.equal(detailed.state.moreObjects, undefined, 'all objects are present in model detail');
  assert.deepEqual(detailed.state.snapshot, state.snapshot);
  assert.deepEqual(presentSession({ state }, 'timeline').state.timeline, state.review);
  assert.deepEqual(
    presentSession({ state }, 'presentation').state.presentation,
    state.presentation,
  );
  for (const detail of ['state', 'model', 'timeline', 'presentation']) {
    const once = presentSession({ sessionId: 'shown', state, result: [{ id: 'move' }] }, detail);
    assert.deepEqual(wire(presentSession(wire(once), detail)), wire(once));
  }
});

test('failed preparation retains a separately confirmed cue across projection boundaries', () => {
  const cues = [
    { id: 'first', start: 0, end: 5, action: 'First drawing' },
    { id: 'second', start: 5, end: 10, action: 'Second drawing' },
  ];
  const checkpoint = { time: 0, cue: 'first', mode: 'story', values: { x: 1 } };
  const report = presentSession({
    checkpoint,
    state: {
      time: 6,
      duration: 10,
      mode: 'story',
      review: { cues, segments: [] },
      rendering: { phase: 'failed', requested: { time: 6 }, presented: { time: 0 } },
    },
  });
  assert.equal(report.state.cue.id, 'second', 'inspection retains accepted input detail');
  assert.deepEqual(report.state.presentedCue, cues[0], 'observation describes the retained picture');
  assert.deepEqual(wire(presentSession(wire(report))), wire(report));
  const brokenRender = presentSession({
    state: { time: 6, duration: 10, review: { cues }, rendering: { phase: 'failed' } },
  });
  assert.equal(brokenRender.state.presentedCue, undefined, 'an unconfirmed frame has no presented cue');
});
