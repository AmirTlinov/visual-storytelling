import test from 'node:test';
import assert from 'node:assert/strict';
import { Morph } from '../dist/morph/objects.js';
import { volumeField } from '../dist/viewport/morph/field.js';

const visibleEndpoint = (frame) => {
  assert.ok(frame.morph === 0 || frame.morph === 1);
  return frame.morph === 0 ? frame.sources : frame.targets;
};
const identity = (objects) => objects.map(({ shape, text }) => ({ shape, text }));
const fieldFor = (plan) => {
  const frame = plan.sample(0);
  return volumeField(
    frame.sources.map((p) => p.shape),
    frame.targets.map((p) => p.shape),
  );
};

test('written operations preserve their endpoint bodies and inscriptions through arbitrary seeks', () => {
  const parts = [
    Morph.box([0.7, 1.2, 0.4], 'Свет'),
    Morph.sphere(0.55, 'Тень'),
    Morph.box([1.3, 0.6, 0.8], 0),
  ];
  const whole = Morph.capsule(0.65, 3.5, 'Объём');
  for (const operation of [
    Morph.transform(parts[0], whole),
    Morph.merge(parts, whole),
    Morph.split(whole, parts),
  ]) {
    const plan = Morph.plan(operation);
    assert.deepEqual(identity(visibleEndpoint(plan.sample(0))), identity(operation.sources));
    assert.deepEqual(identity(visibleEndpoint(plan.sample(1))), identity(operation.targets));
    assert.deepEqual(plan.sample(-1), plan.sample(0));
    assert.deepEqual(plan.sample(2), plan.sample(1));
    const before = structuredClone(plan.sample(0.413));
    const field = fieldFor(plan);
    for (const p of [1, 0.2, 0.413, 0.75, 0, 0.94]) {
      field.update(plan.sample(p));
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(field.bounds.min.getComponent(axis) >= plan.bounds[0][axis] - 1e-6);
        assert.ok(field.bounds.max.getComponent(axis) <= plan.bounds[1][axis] + 1e-6);
      }
    }
    assert.deepEqual(
      plan.sample(0.413),
      before,
      'seeking must not change a later visit to the same frame',
    );
    for (const p of [NaN, Infinity, -Infinity]) assert.throws(() => plan.sample(p), /finite/);
  }
});

test('approaching bodies keep their rest shape and ink until actual contact', () => {
  const scenarios = [
    [[Morph.sphere(0.5, 1), Morph.sphere(0.5, 2)], Morph.capsule(0.5, 2, 3)],
    [[Morph.box([1, 1, 0.8], 'А'), Morph.sphere(0.5, 'Б')], Morph.capsule(0.6, 2.2, 'АБ')],
    [[Morph.box([1, 1, 1], 2), Morph.box([1, 1, 1], 2)], Morph.sphere(0.7, 4)],
  ];
  const width = (shape) =>
    shape.kind === 'box'
      ? shape.size[0]
      : shape.kind === 'sphere'
        ? shape.radius * 2
        : shape.length;
  for (const [parts, whole] of scenarios) {
    const plan = Morph.plan(Morph.merge(parts, whole)),
      field = fieldFor(plan);
    let approached = 0,
      contacted = 0;
    for (let step = 0; step <= 100; step++) {
      const frame = plan.sample(step / 100);
      const gap =
        frame.sources[1].position[0] -
        frame.sources[0].position[0] -
        (width(parts[0].shape) * (frame.sources[0].scale?.[0] ?? 1) +
          width(parts[1].shape) * (frame.sources[1].scale?.[0] ?? 1)) /
          2;
      if (gap > 1e-8) {
        approached++;
        assert.equal(frame.morph, 0, 'contour and inscription wait for material contact');
        assert.equal(frame.tension, 0, 'no attraction or surface blend across empty air');
        for (const body of frame.sources) {
          assert.equal(body.rounding ?? 0, body.shape.rounding ?? 0);
          assert.equal(body.scale, undefined, 'approach is a rigid translation');
        }
        field.update(frame);
        const seam = frame.sources[0].position[0] + width(parts[0].shape) / 2 + gap / 2;
        assert.ok(field.distance(seam, 0, 0) > 0, 'the gap is actually empty in the drawn field');
      } else contacted++;
    }
    assert.ok(approached > 20 && contacted > 40);
  }
});
test('contact in multiple rows remains rigid through the approach and responds on both axes', () => {
  const parts = Array.from({ length: 4 }, () => Morph.box([1, 1, 1], 1));
  const plan = Morph.plan(Morph.merge(parts, Morph.box([2, 2, 1], 4)), { columns: 2 });
  const positions = [
    [-0.85, 0.85, 0],
    [0.85, 0.85, 0],
    [-0.85, -0.85, 0],
    [0.85, -0.85, 0],
  ];
  plan
    .sample(0)
    .sources.forEach((body, i) =>
      body.position.forEach((v, axis) => assert.ok(Math.abs(v - positions[i][axis]) < 1e-12)),
    );
  for (const p of [0.01, 0.1, 0.2])
    for (const body of plan.sample(p).sources) assert.equal(body.scale, undefined);
  const frame = plan.sample(0.35),
    stretch = frame.sources[0].scale;
  assert.ok(stretch);
  assert.ok(
    Math.abs(stretch[0] - stretch[1]) < 1e-9,
    'symmetric contact has no preferred packing axis',
  );
  for (const count of [3, 4]) {
    const row = Morph.plan(
      Morph.merge(
        Array.from({ length: count }, () => Morph.box([1.4, 1.4, 1.4])),
        Morph.box([2, 2, 2]),
      ),
    );
    for (const p of [0.02, 0.1, 0.2])
      for (const body of row.sample(p).sources)
        assert.equal(
          body.scale,
          undefined,
          'a body between separated pieces is not their connecting neck',
        );
  }
});

test('material response is short, bounded and preserves inscriptions and material volume', () => {
  const parts = [Morph.box([1, 1, 1], 2), Morph.box([1, 1, 1], 2)];
  const whole = Morph.capsule(0.5, 2, 4);
  for (const operation of [
    Morph.merge(parts, whole),
    Morph.split(whole, parts),
    Morph.transform(parts[0], whole),
  ]) {
    const plan = Morph.plan(operation);
    let responding = 0;
    for (let i = 0; i <= 200; i++) {
      const frame = plan.sample(i / 200);
      for (const body of [...frame.sources, ...frame.targets]) {
        const scale = body.scale ?? [1, 1, 1];
        assert.ok(Math.abs(scale.reduce((v, n) => v * n, 1) - 1) < 1e-12);
        assert.ok(scale.every((v) => v > 0.976 && v < 1.025));
        if (scale.some((v) => Math.abs(v - 1) > 1e-5)) responding++;
      }
    }
    assert.ok(responding > 0, 'moving material responds to its changing load');
    assert.ok(
      (plan.sample(0.99999).sources[0].scale ?? [1, 1, 1]).every((v) => Math.abs(v - 1) < 0.0001),
      'the clock leaves enough time for a settled endpoint',
    );
    assert.ok([...plan.sample(1).sources, ...plan.sample(1).targets].every((p) => !p.scale));
    const earlier = structuredClone(plan.sample(0.81));
    for (const p of [1, 0.2, 0.98, 0]) plan.sample(p);
    assert.deepEqual(plan.sample(0.81), earlier);
  }
});

test('plan bounds contain contact reach while approach and contour morph overlap', () => {
  const parts = [1, 2, 3].map((value) => Morph.box([2, 2, 2], value));
  const whole = Morph.box([2, 2.28, 2], 6);
  for (const operation of [Morph.merge(parts, whole), Morph.split(whole, parts)]) {
    const plan = Morph.plan(operation),
      field = fieldFor(plan);
    for (const forward of [0, 0.3, 0.44, 0.55, 0.95, 1]) {
      const progress = operation.kind === 'split' ? 1 - forward : forward;
      field.update(plan.sample(progress));
      for (let axis = 0; axis < 3; axis++) {
        assert.ok(
          field.bounds.min.getComponent(axis) >= plan.bounds[0][axis] &&
            field.bounds.max.getComponent(axis) <= plan.bounds[1][axis],
          `${operation.kind} at ${progress}: registered contact escaped axis ${axis}`,
        );
      }
    }
  }
});

test('a malformed measurement grid is rejected before a renderer can enter its line loop', () => {
  const box = Morph.box([1, 1, 1], 1);
  for (const grid of [-1, NaN, Infinity, 1e-12])
    assert.throws(() => Morph.plan(Morph.transform({ ...box, grid }, box)), /grid|step|lines/);
  assert.doesNotThrow(() => Morph.plan(Morph.transform({ ...box, grid: 0.25 }, box)));
});

test('parts retain the whole curvature while connected and settle into cubes after release', () => {
  const cubes = Array.from({ length: 3 }, () => Morph.box([1.15, 1.15, 0.97], 2));
  for (const radius of [0.62, 0.2]) {
    const plan = Morph.plan(Morph.split(Morph.capsule(radius, 3.45, 6), cubes));
    const field = fieldFor(plan);
    let connected = 0,
      detached = 0;
    for (let i = 40; i <= 100; i++) {
      const frame = plan.sample(i / 100);
      field.update(frame);
      const middle = (frame.sources[2].position[0] * field.registration[0]) / 2;
      if (field.distance(middle, 0, 0) < -1e-5) {
        connected++;
        assert.ok(
          frame.sources.every((p) => p.rounding > 0.48),
          'A connected rounded whole must not gain rigid outside corners',
        );
      } else detached++;
    }
    assert.ok(connected > 10 && detached > 10);
    assert.ok(
      plan.sample(1).sources.every((p) => p.rounding === 0),
      'Released bodies reach their declared shape',
    );
    const earlier = structuredClone(plan.sample(0.7));
    for (const p of [0, 1, 0.3, 0.65, 0.8]) plan.sample(p);
    assert.deepEqual(
      plan.sample(0.7),
      earlier,
      'release and recoil share the seekable operation clock',
    );
  }
});

test('contact response follows speed and material scale instead of a prescribed pulse', () => {
  const peak = (size, duration) => {
    const cubes = [1, 2].map((n) => Morph.box([size, size, size], n));
    const plan = Morph.plan(Morph.merge(cubes, Morph.box([size * 2, size, size], 3)));
    let maximum = 0;
    for (let i = 0; i <= 400; i++) {
      const frame = plan.sample(i / 400, duration);
      maximum = Math.max(
        maximum,
        ...frame.sources.flatMap((body) => (body.scale ?? [1, 1, 1]).map((v) => Math.abs(v - 1))),
      );
    }
    return maximum;
  };
  const normal = peak(1, 4),
    slower = peak(1, 8);
  assert.ok(normal > 0.005 && slower < normal * 0.7, 'slower contact supplies less momentum');
  assert.ok(
    Math.abs(peak(3, 4) - normal) < 1e-6,
    'changing drawing units does not change the material',
  );
  const still = Morph.plan(Morph.transform(Morph.box([1, 1, 1], 1), Morph.box([1, 1, 1], 1)));
  for (const p of [0, 0.1, 0.35, 0.6, 0.9, 1])
    assert.equal(still.sample(p).sources[0].scale, undefined, 'no load means no decorative wobble');
  for (const duration of [NaN, Infinity, -1])
    assert.throws(() => still.sample(0.4, duration), /duration/);
});

test('contact impulses do not leak into fractional pre-contact frames and short gestures settle', () => {
  const parts = [1, 2].map((n) => Morph.box([1, 1, 1], n));
  const whole = Morph.capsule(0.5, 2, 3);
  const plan = Morph.plan(Morph.merge(parts, whole));
  const gap = (frame) =>
    frame.sources[1].position[0] -
    frame.sources[0].position[0] -
    (frame.sources[0].scale?.[0] ?? 1);
  for (const duration of [0.5, 2, 3.4]) {
    // Locate physical contact from the public poses, independently of the
    // response solver's clock, sample count or interpolation implementation.
    let before = 0,
      after = 0.5;
    for (let i = 0; i < 32; i++) {
      const p = (before + after) / 2;
      if (gap(plan.sample(p, duration)) > 1e-8) before = p;
      else after = p;
    }
    for (const offset of [0.003, 0.001, 0.00025, 0.000001]) {
      const frame = plan.sample(before - offset, duration);
      assert.ok(gap(frame) > 0);
      assert.equal(frame.morph, 0);
      assert.ok(
        frame.sources.every((body) => body.scale === undefined),
        `duration ${duration}: future collision deformed separated bodies`,
      );
    }
    assert.ok(
      plan.sample(after + 0.03, duration).sources.some((body) => body.scale),
      'the actual collision still excites the material',
    );
  }
  for (const operation of [
    Morph.merge(parts, whole),
    Morph.split(whole, parts),
    Morph.transform(parts[0], whole),
  ]) {
    const short = Morph.plan(operation);
    for (const p of [0.99, 0.9999, 1 - 1e-8]) {
      const frame = short.sample(p, 0.5);
      assert.ok(
        [...frame.sources, ...frame.targets].every((body) =>
          (body.scale ?? [1, 1, 1]).every((value) => Math.abs(value - 1) < 1e-4),
        ),
        'the exact endpoint must not conceal an unsettled short response',
      );
    }
  }
  const healthy = structuredClone(plan.sample(0.4, 3.4));
  assert.throws(
    () => plan.sample(0.4, 1e-300),
    /Spring stiffness/,
    'an unrepresentable spring must not publish NaN geometry',
  );
  assert.deepEqual(
    plan.sample(0.4, 3.4),
    healthy,
    'a rejected duration leaves the previous response usable',
  );
});
