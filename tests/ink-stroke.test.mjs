import test from 'node:test';
import assert from 'node:assert/strict';
import { inkLine, updateInkLine, drawInkLine, InkStroke3D } from '../dist/viewport/ink-line.js';

const end = (line) => {
  const i = line.geometry.instanceCount - 1,
    attribute = line.geometry.getAttribute('instanceEnd');
  return [attribute.getX(i), attribute.getY(i), attribute.getZ(i)];
};
test('drawn ink follows distance, rewinds exactly and keeps its full framing', () => {
  const line = inkLine(true);
  try {
    updateInkLine(line, [
      [0, 0],
      [1, 0],
      [10, 0],
    ]);
    const bounds = line.geometry.boundingBox.clone();
    drawInkLine(line, 0.5);
    assert.deepEqual(end(line), [5, 0, 0]);
    assert.equal(line.geometry.getAttribute('instanceDistanceEnd').getX(1), 5);
    drawInkLine(line, 0.05);
    assert.deepEqual(end(line), [0.5, 0, 0]);
    drawInkLine(line, 1);
    assert.deepEqual(end(line), [10, 0, 0]);
    assert.equal(line.geometry.getAttribute('instanceEnd').getX(0), 1);
    drawInkLine(line, 0.5);
    assert.deepEqual(end(line), [5, 0, 0]);
    assert.deepEqual(line.geometry.boundingBox, bounds);
    drawInkLine(line, 0);
    assert.equal(line.geometry.instanceCount, 0);
  } finally {
    line.geometry.dispose();
    line.material.dispose();
  }
});

test('a travelling object follows the visible tip through uneven segments, edits and rewinds', () => {
  const stroke = InkStroke3D.create({ ink() {}, invalidate() {} }, [
    [0, 0],
    [0, 0],
    [1, 0],
    [10, 0],
    [10, 0],
  ]);
  try {
    for (const progress of [0.5, 1, 0.05, 0.1, 0.9]) {
      stroke.draw(progress);
      assert.deepEqual(stroke.pointAt(progress), [progress * 10, 0, 0]);
      assert.deepEqual(stroke.pointAt(progress), end(stroke.root));
    }
    assert.deepEqual(stroke.pointAt(-1), [0, 0, 0]);
    assert.deepEqual(stroke.pointAt(2), [10, 0, 0]);
    stroke.draw(0.5);
    stroke.points([
      [2, 1, 3],
      [2, 1, 13],
    ]);
    assert.deepEqual(stroke.pointAt(0.5), [2, 1, 8]);
    assert.deepEqual(end(stroke.root), [2, 1, 8]);
    stroke.points([[2, 1, 3]]);
    assert.deepEqual(stroke.pointAt(0.5), [2, 1, 3]);
    stroke.points([]);
    assert.equal(stroke.pointAt(0.5), undefined);
    assert.throws(() => stroke.pointAt(NaN), /finite/);
  } finally {
    stroke.root.geometry.dispose();
    stroke.root.material.dispose();
  }
});
test('a trace can shrink to a point and grow with fresh GPU capacity and no invalid bounds', () => {
  const line = inkLine(false);
  try {
    updateInkLine(line, [
      [0, 0],
      [1, 1],
    ]);
    const first = line.geometry;
    updateInkLine(line, [[0, 0]]);
    assert.equal(line.geometry.instanceCount, 0);
    updateInkLine(line, [
      [0, 0],
      [0, 0],
      [0, 2],
      [4, 2],
    ]);
    assert.notEqual(line.geometry, first);
    drawInkLine(line, 0.5);
    assert.deepEqual(end(line), [1, 2, 0]);
    updateInkLine(line, []);
    drawInkLine(line, 1);
    assert.equal(line.geometry.instanceCount, 0);
    assert.equal(line.geometry.boundingSphere.radius, 0);
    assert.throws(() => updateInkLine(line, [[NaN, 0]]), /finite/);
  } finally {
    line.geometry.dispose();
    line.material.dispose();
  }
});
