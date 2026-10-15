import test from 'node:test';
import assert from 'node:assert/strict';
import { drawingCandidate } from '../dist/recipes/drawing-candidate.js';
import { sceneAccess } from '../dist/scene-access.js';
import { captureScene } from '../dist/scene-checkpoint.js';

test('a checked concealed drawing is consumed once, with bounded lifetime and failed candidates discarded', () => {
  const candidates = drawingCandidate();
  let built = 0,
    disposed = [];
  const prepare = () => {
    const id = ++built,
      attributes = new Map();
    const parent = {
      appendChild(node) {
        node.parentNode = this;
      },
    };
    return {
      id,
      attributes,
      canvas: {
        parentNode: parent,
        remove() {
          this.parentNode = null;
        },
        setAttribute: (key, value) => attributes.set(key, value),
        removeAttribute: (key) => attributes.delete(key),
      },
      dispose: () => disposed.push(id),
    };
  };
  candidates.check('a', prepare);
  candidates.check('a', prepare);
  assert.equal(built, 1);
  const accepted = candidates.take('a');
  assert.equal(accepted.id, 1);
  assert(
    accepted.canvas.parentNode,
    'render consumes the measured drawing in its original surface',
  );
  assert.equal(accepted.attributes.has('data-presentation-pending'), false);
  assert.equal(candidates.take('a'), undefined);
  candidates.check('b', prepare);
  candidates.check('c', prepare);
  assert.deepEqual(disposed, [2]);
  assert.throws(
    () =>
      candidates.check('c', prepare, () => {
        throw Error('caption does not fit');
      }),
    /caption does not fit/,
  );
  assert.deepEqual(disposed, [2, 3]);
  assert.equal(candidates.take('c'), undefined);
  candidates.check('d', prepare);
  assert.equal(candidates.take('different'), undefined);
  assert.deepEqual(disposed, [2, 3, 4]);
  candidates.check('e', prepare);
  candidates.dispose();
  candidates.dispose();
  assert.deepEqual(disposed, [2, 3, 4, 5], 'the accepted drawing is retained by its renderer');
  accepted.dispose();
});

test('history captures the whole condition without reading object geometry; ordinary inspect remains complete', () => {
  let objectReads = 0;
  const handle = {
    currentTime: 0,
    duration: 0,
    selected: ['load'],
    objects() {
      objectReads++;
      return [{ id: 'load', label: 'Груз', visible: true }];
    },
    snapshot: () => ({ weight: 4 }),
    review: () => ({ duration: 0, cues: [], segments: [] }),
    select() {},
    subject: { capture: () => ({ version: 1, input: { weight: 4 } }) },
  };
  handle.inspect = sceneAccess(handle, {
    assertLive() {},
    mode: () => 'explore',
    values: () => ({ weight: 4 }),
    parameters: [{ key: 'weight', label: 'Вес', value: 4 }],
  }).inspect;
  const captured = captureScene(handle);
  assert.equal(objectReads, 0);
  assert.deepEqual(captured.values, { weight: 4 });
  assert.deepEqual(captured.selected, ['load']);
  assert.deepEqual(captured.subject, { version: 1, input: { weight: 4 } });
  const inspection = handle.inspect({ presentation: false });
  assert.equal(objectReads, 1);
  assert.equal(inspection.objects[0].id, 'load');
  assert(inspection.capabilities.includes('select'));
});
