import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { cameraView3D } from '../dist/viewport/camera-view.js';

test('custom shots preserve an unbounded manual orbit through JSON and restore older saved poses', () => {
  const camera = new PerspectiveCamera(36, 4 / 3, 0.01, 1000);
  const controls = { target: new Vector3(), minDistance: 0, maxDistance: Infinity, update() {} };
  const view = cameraView3D({
    stage: { clientWidth: 800, clientHeight: 600 },
    camera,
    controls,
    labels: { anchors: () => [] },
    invalidate() {},
    subjectIds: () => ['subject'],
  });
  view.shot((c) => {
    c.position.set(1, 2, 10);
    c.updateMatrixWorld();
  });
  view.manual();
  const saved = JSON.parse(JSON.stringify(view.capture()));
  assert.equal(saved.maxDistance, null);
  camera.position.set(5, 1, 6);
  assert.equal(view.restore(saved), true);
  assert.deepEqual(view.capture(), saved);
  assert.equal(controls.maxDistance, Infinity);
  const previous = { ...saved };
  for (const key of ['near', 'far', 'minDistance', 'maxDistance']) delete previous[key];
  camera.position.set(9, 4, 2);
  assert.equal(view.restore(previous), true);
  assert.deepEqual(camera.position.toArray(), saved.position);
  assert.equal(view.restore({ ...saved, near: undefined }), false);
  assert.equal(view.restore({ ...saved, maxDistance: 0 }), false);
  assert.equal(view.restore({ ...saved, near: NaN }), false);
});
