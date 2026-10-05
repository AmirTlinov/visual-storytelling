import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Group, Matrix4, Mesh, MeshBasicMaterial, Vector3 } from 'three';
import { mathDelivery3D } from '../dist/morph/delivery-3d.js';

const result = {
  sources: [],
  targets: [{ position: [0.3, -0.2, 0.1], size: [1.4, 1.2, 1] }],
  stage: 0,
  phase: 'hold',
  morph: 1,
  formula: '2 + 3 = 5',
};
const close = (actual, expected, tolerance = 1e-9) => {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) =>
    assert.ok(Math.abs(value - expected[i]) < tolerance, `${i}: ${value} != ${expected[i]}`),
  );
};
function fixture() {
  const world = new Group(),
    calculation = new Group(),
    source = new Group(),
    frame = new Group();
  const to = new Mesh(
    new BoxGeometry(1.4, 1.3, 0.5).translate(0.2, 0.1, -0.3),
    new MeshBasicMaterial(),
  );
  world.add(calculation, frame);
  calculation.add(source);
  frame.add(to);
  // Ordinary positive TRS parents produce shear in the child's world transform.
  const poses = [
    [calculation, [2.64, 1.1, 0.46], [0.34, 0.39, 3.3]],
    [source, [1.15, 3.51, 1.94], [1.94, 1.15, 0.62]],
    [frame, [5.94, 3.97, 5.13], [0.99, 2.15, 0.27]],
    [to, [0.55, 3.86, 3.63], [0.34, 0.31, 0.45]],
  ];
  for (const [object, rotation, scale] of poses) {
    object.rotation.set(...rotation);
    object.scale.set(...scale);
  }
  calculation.position.set(-2, 0.5, 0.3);
  source.position.set(0.2, -0.7, 0.4);
  frame.position.set(3, 1, -2);
  to.position.set(-0.5, 0.3, 0.8);
  const original = new Matrix4().compose(source.position, source.quaternion, source.scale);
  return {
    world,
    calculation,
    source,
    to,
    original,
    dispose() {
      to.geometry.dispose();
      to.material.dispose();
    },
  };
}

test('delivery preserves nested affine poses, fits actual receiver geometry and rewinds without inversion', () => {
  const lab = fixture();
  const via = [0, 2, 0.5];
  const delivery = mathDelivery3D(lab.source, { to: lab.to, via });
  try {
    const snapshots = new Map();
    for (const progress of [0, 0.12, 0.5, 0.7, 0.999999, 1, 0.7, 0, 1]) {
      const bounds = delivery.render(result, 1, progress);
      lab.world.updateMatrixWorld(true);
      assert.ok(lab.source.matrixWorld.determinant() > 0, `inverted at ${progress}`);
      const matrix = lab.source.matrix.elements.slice();
      if (snapshots.has(progress)) close(matrix, snapshots.get(progress));
      snapshots.set(progress, matrix);
      assert.equal(lab.to.visible, progress === 1);
      assert.equal(lab.source.visible, progress < 1);
      if (progress === 0) close(matrix, lab.original.elements);
      else assert.ok(bounds && !bounds.isEmpty());
      if (progress === 0.5) {
        const origin = new Vector3(...result.targets[0].position).applyMatrix4(
          new Matrix4().multiplyMatrices(lab.calculation.matrixWorld, lab.original),
        );
        const end = lab.to.geometry.boundingBox
          .getCenter(new Vector3())
          .applyMatrix4(lab.to.matrixWorld);
        const expected = origin
          .multiplyScalar(0.25)
          .addScaledVector(new Vector3(...via), 0.5)
          .addScaledVector(end, 0.25);
        close(
          new Vector3(...result.targets[0].position).applyMatrix4(lab.source.matrixWorld).toArray(),
          expected.toArray(),
        );
      }
      if (progress === 1) {
        const target = lab.to.geometry.boundingBox;
        for (const x of [0, 1])
          for (const y of [0, 1])
            for (const z of [0, 1]) {
              const point = new Vector3(...result.targets[0].position)
                .add(new Vector3((x - 0.5) * 1.4, (y - 0.5) * 1.2, z - 0.5))
                .applyMatrix4(lab.source.matrixWorld);
              const expected = new Vector3(
                x ? target.max.x : target.min.x,
                y ? target.max.y : target.min.y,
                z ? target.max.z : target.min.z,
              ).applyMatrix4(lab.to.matrixWorld);
              close(point.toArray(), expected.toArray());
            }
      }
    }
  } finally {
    delivery.dispose();
    lab.dispose();
  }
});

test('reduced motion validates the authored delivery and holds disclosure until arrival', () => {
  const lab = fixture(),
    delivery = mathDelivery3D(lab.source, { to: lab.to });
  try {
    delivery.render(result, 1, 0);
    assert.throws(() => delivery.render({ ...result, phase: 'contact' }, 1, 0.2, true), /settled/);
    assert.throws(() => delivery.render(result, 2, 0.2, true), /settled/);
    for (const progress of [0.2, 1, 0.2, 0]) {
      delivery.render(result, 1, progress, true);
      assert.equal(lab.to.visible, progress === 1);
      if (progress !== 1) close(lab.source.matrix.elements, lab.original.elements);
    }
  } finally {
    delivery.dispose();
    lab.dispose();
  }
});

test('receiver ownership rolls back errors and an old disposal cannot release a new delivery', () => {
  const lab = fixture();
  try {
    assert.throws(() => mathDelivery3D(lab.source, { to: lab.to, bounds: new Box3() }), /bounds/);
    assert.equal(lab.to.visible, true);
    const first = mathDelivery3D(lab.source, { to: lab.to });
    first.render(result, 1, 0.4);
    const held = lab.source.matrix.elements.slice();
    const parent = lab.to.parent;
    lab.to.removeFromParent();
    assert.throws(() => first.render(result, 1, 0.6), /same scene/);
    close(lab.source.matrix.elements, held);
    parent.add(lab.to);
    lab.to.scale.x *= -1;
    assert.throws(() => first.render(result, 1, 0.6), /handedness/);
    close(lab.source.matrix.elements, held);
    assert.equal(lab.to.visible, false);
    lab.to.scale.x = 0;
    assert.throws(() => first.render(result, 1, 0.6), /collapsed/);
    close(lab.source.matrix.elements, held);
    lab.to.scale.x = NaN;
    assert.throws(() => first.render(result, 1, 0.6), /non-finite/);
    close(lab.source.matrix.elements, held);
    first.dispose();
    assert.equal(lab.to.visible, true);
    assert.equal(lab.source.matrixAutoUpdate, true);
    close(lab.source.matrix.elements, lab.original.elements);
    lab.to.scale.x = 0.34;
    const second = mathDelivery3D(lab.source, { to: lab.to });
    second.render(result, 1, 0);
    first.dispose();
    assert.equal(lab.to.visible, false);
    assert.throws(() => mathDelivery3D(lab.source, { to: lab.to }), /already has/);
    second.dispose();
  } finally {
    lab.dispose();
  }
});
