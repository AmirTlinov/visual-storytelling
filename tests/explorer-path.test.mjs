import test from 'node:test';
import assert from 'node:assert/strict';
import { ScenePath } from '../dist/explorer/path.js';

test('restoring a deep path stops at invalid input and cross-links return to one ancestor', () => {
  const root = { id: 'root' },
    middle = { id: 'middle' },
    leaf = { id: 'leaf' };
  const children = (node) =>
    node === root
      ? [{ key: 'middle', node: middle }]
      : node === middle
        ? [
            { key: 'leaf', node: leaf },
            { key: 'root', node: root },
          ]
        : [];
  const path = new ScenePath(root, (node) => node.id);
  path.restore(['middle', 'leaf', 'missing'], children);
  assert.deepEqual(path.keys, ['middle', 'leaf']);
  assert.equal(path.current, leaf);
  path.pop();
  path.enter(children(middle)[1]);
  assert.equal(path.current, root);
  assert.equal(path.length, 1);
  path.restore(['middle', 'missing', 'leaf'], children);
  assert.deepEqual(path.keys, ['middle']);
  path.restore({}, children);
  assert.equal(path.current, root);
});
