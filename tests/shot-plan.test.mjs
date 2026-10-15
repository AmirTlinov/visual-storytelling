import test from 'node:test';
import assert from 'node:assert/strict';
import { ThreeKit as T, shotPlan3D, shotProgress } from '../dist/viewport/index.js';
import { shotPose } from '../dist/viewport/shots.js';

const box = (size, center = [0, 0, 0]) =>
  new T.Box3().setFromCenterAndSize(new T.Vector3(...center), new T.Vector3(size, size, size));
const script = {
  duration: 12,
  cues: { region: { start: 2, end: 6 }, detail: { start: 7, end: 12 } },
};

test('authored camera predecessors and observation intervals survive arbitrary seek and geometry mutation', () => {
  const country = box(1000),
    region = box(30, [300, 0, 200]),
    detail = box(0.002, [301, 0, 201]);
  const plan = shotPlan3D(script, { target: country }, [
    { cue: 'region', shot: { target: region }, move: 2 },
    { cue: 'detail', shot: { target: detail }, move: 3 },
  ]);
  const expected = plan.at(8);
  country.translate(new T.Vector3(100, 0, 0));
  region.makeEmpty();
  detail.expandByScalar(1e6);
  const exposed = plan.at(8);
  exposed.shot.bounds.makeEmpty();
  exposed.shot.from.bounds.makeEmpty();
  for (const time of [12, 0, 11, 3, 8, 6, 1]) plan.at(time);
  assert.deepEqual(plan.at(8), expected);
  assert.equal(plan.at(1).cue, undefined);
  assert.equal(plan.at(3).phase, 'move');
  assert.equal(plan.at(4).phase, 'observe');
  assert.equal(plan.at(6.5).cue, 'region');
  assert.equal(plan.at(6.5).progress, 1);
  assert.equal(plan.at(7).amount, 0);
  assert.equal(plan.at(7.01, true).amount, 1);
  assert.equal(plan.at(10).phase, 'observe');
  assert.deepEqual(plan.at(8).shot.from.bounds.getSize(new T.Vector3()).toArray(), [30, 30, 30]);
});

test('camera plans reject ambiguous timing and explicitly invalid envelopes', () => {
  const initial = { target: box(1) },
    leg = { cue: 'region', shot: initial, move: 2 };
  for (const legs of [
    [],
    [leg, leg],
    [{ ...leg, move: 5 }],
    [{ ...leg, move: -1 }],
    [{ ...leg, cue: 'missing' }],
  ])
    assert.throws(() => shotPlan3D(script, initial, legs));
  assert.throws(() =>
    shotPlan3D(script, initial, [
      { ...leg, shot: { target: new T.Mesh(new T.BoxGeometry()), bounds: new T.Box3() } },
    ]),
  );
  assert.throws(() => shotProgress(NaN));
});

test('an authored movement adapts to short aligned narration and reserves observation time', () => {
  const target = { target: box(1) };
  const short = { duration: 1, cues: { detail: { start: 0, end: 1 } } };
  const move = { fraction: 0.85, maxSeconds: 3 };
  const plan = shotPlan3D(short, target, [{ cue: 'detail', shot: target, move }]);
  assert.equal(plan.at(0.5).phase, 'move');
  assert.equal(plan.at(0.85).phase, 'observe');
  assert.equal(plan.at(1).progress, 1);
  for (const invalid of [
    { fraction: NaN, maxSeconds: 3 },
    { fraction: 1.1, maxSeconds: 3 },
    { fraction: 0.8, maxSeconds: -1 },
  ])
    assert.throws(() =>
      shotPlan3D(short, target, [{ cue: 'detail', shot: target, move: invalid }]),
    );
});

test('camera movement uses the same delayed action interval as Story', () => {
  const plan = shotPlan3D(
    {
      duration: 10,
      cues: {
        focus: { start: 0, end: 1, timing: { delay: 2, duration: 3 } },
      },
    },
    { target: box(100) },
    [{ cue: 'focus', shot: { target: box(1) }, move: 1 }],
  );
  assert.equal(plan.at(1).cue, undefined);
  assert.equal(plan.at(2).progress, 0);
  assert.equal(plan.at(2.5).progress, 0.5);
  assert.equal(plan.at(3).phase, 'observe');
});

test('country-to-building zoom keeps physical scale and a local depth range at the endpoint', () => {
  for (const width of [390, 1200]) {
    const camera = new T.PerspectiveCamera(36, width / 675, 0.01, 1e6);
    const overview = { target: box(1000), direction: [1, 1, 2] };
    const building = { target: box(0.002, [300, 0, 200]), direction: [1, 1, 2] };
    const pose = shotPose(camera, width, 675, { ...building, from: overview, progress: 1 });
    assert(
      pose.position.distanceTo(pose.target) < 0.02,
      'a fixed world floor makes a building unreadable',
    );
    assert(pose.far / pose.near < 15000, 'country bounds still control close-up depth precision');
    camera.near = pose.near;
    camera.far = pose.far;
    camera.position.copy(pose.position);
    camera.lookAt(pose.target);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    for (const x of [building.target.min.x, building.target.max.x])
      for (const y of [building.target.min.y, building.target.max.y])
        for (const z of [building.target.min.z, building.target.max.z]) {
          const point = new T.Vector3(x, y, z).project(camera);
          assert(Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1);
        }
  }
});

test('changing the whole scene unit preserves point and detail camera composition throughout its plan', () => {
  const camera = new T.PerspectiveCamera(36, 390 / 675, 0.01, 1e6);
  const create = (unit) =>
    shotPlan3D(script, { target: box(1000 * unit) }, [
      { cue: 'region', shot: { target: box(0, [300 * unit, 0, 200 * unit]) }, move: 2 },
      { cue: 'detail', shot: { target: box(0.002 * unit, [301 * unit, 0, 201 * unit]) }, move: 3 },
    ]);
  const baseline = create(1);
  for (const unit of [1e-6, 1e-3, 1e3])
    for (const time of [0, 2, 3, 4, 7, 8, 10, 12]) {
      const a = shotPose(camera, 390, 675, baseline.at(time).shot);
      const b = shotPose(camera, 390, 675, create(unit).at(time).shot);
      for (const key of ['position', 'target'])
        assert(
          a[key].distanceTo(b[key].clone().multiplyScalar(1 / unit)) < 1e-5,
          `unit ${unit}, time ${time}`,
        );
      for (const key of ['near', 'far', 'radius']) assert(Math.abs(a[key] - b[key] / unit) < 1e-5);
    }
});

test('moving a regular subject far from the origin cannot turn its coordinate magnitude into geometry', () => {
  const camera = new T.PerspectiveCamera(36, 390 / 675, 0.01, 1e6);
  const distance = (center) => {
    const pose = shotPose(camera, 390, 675, { target: box(1, center) });
    return pose.position.distanceTo(pose.target);
  };
  assert(Math.abs(distance([0, 0, 0]) - distance([1e10, 0, 0])) < 1e-4);
  assert.throws(() => shotPose(camera, 390, 675, { target: box(0) }), /referenceScale/);
  assert(shotPose(camera, 390, 675, { target: box(0), referenceScale: 100 }).near > 0);
});

test('a selected part stays visible through a many-scale approach and its reverse', () => {
  for (const width of [390, 1200]) {
    const camera = new T.PerspectiveCamera(36, width / 675, 0.01, 1e6);
    const focus = new T.Vector3(-450, 0, 100),
      overview = { target: box(1000), direction: [0.4, 1.2, 1.8] },
      detail = { target: box(0.002, focus.toArray()), direction: [0.4, 1.2, 1.8] };
    for (const [from, to] of [
      [overview, detail],
      [detail, overview],
    ])
      for (let i = 0; i <= 100; i++) {
        const pose = shotPose(camera, width, 675, { ...to, from, progress: i / 100 });
        camera.position.copy(pose.position);
        camera.lookAt(pose.target);
        camera.near = pose.near;
        camera.far = pose.far;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();
        const point = focus.clone().project(camera);
        assert(
          Math.abs(point.x) < 1 && Math.abs(point.y) < 1 && Math.abs(point.z) < 1,
          `lost focus at ${width}px, progress${i / 100}`,
        );
      }
  }
});
