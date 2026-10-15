import test from 'node:test';
import assert from 'node:assert/strict';
import { borrowSceneView } from '../dist/scene/view-access.js';

test('borrowed view uses the current owner, preserves void restore success and never captures an inactive camera', () => {
  const first = {
    value: 1,
    reset() {
      this.value = 0;
    },
    focus(ids) {
      this.value = ids.length;
    },
    capture() {
      return this.value;
    },
    restore(state) {
      this.value = state;
    },
    dispose() {
      throw Error('not the borrowed lifetime');
    },
  };
  const second = {
    ...first,
    value: 2,
    restore() {
      return false;
    },
  };
  let owner = first,
    disposed = 0;
  const port = borrowSceneView(
    () => owner,
    () => disposed++,
  );
  assert.equal(port.restore(7), undefined);
  assert.equal(first.value, 7);
  port.focus(['a', 'b']);
  assert.equal(first.value, 2);
  owner = second;
  assert.equal(port.capture(), 2);
  assert.equal(port.restore(9), false);
  owner = undefined;
  assert.equal(port.capture(), undefined);
  assert.equal(port.restore(4), false);
  assert.equal(port.focus, undefined);
  port.dispose();
  assert.equal(disposed, 1);
});
