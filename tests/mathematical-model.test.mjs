import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents: "export { MathMorph } from './dist/index.js';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)),
  },
  bundle: true,
  platform: 'node',
  format: 'esm',
  loader: { '.woff2': 'dataurl' },
  write: false,
});
const { MathMorph } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const explain = (model, objects, steps = [{ to: { t: 1 }, explanation: 'Move' }], extra = {}) =>
  model.explain({ panels: [{ title: 'Relation', objects }], steps, ...extra });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

test('one mathematical snapshot shares evaluated dependencies across panels and formulas', () => {
  const model = MathMorph.model({ t: 0 });
  let calls = 0;
  const relation = model.value(({ t }) => {
    calls++;
    return { point: [t, t * t, t / 2], label: String(t) };
  });
  const point = relation.map((value) => value.point);
  const mapping = relation.map(({ point }) => ([u, v]) => [u + point[0], v, point[2]]);
  const material = model.material(mapping, {
    domain: [
      [0, 0],
      [1, 1],
    ],
  });
  const plan = model.explain({
    panels: [
      { title: 'Point', objects: [model.point(point)] },
      { title: 'Material', objects: [material, model.point(material.at([0, 0]))] },
    ],
    steps: [{ to: { t: 1 }, formula: relation.map((value) => value.label), explanation: 'Move' }],
  });
  calls = 0;
  const frame = plan.sample(0.4);
  assert.equal(calls, 1);
  const t = Number(frame.formula);
  assert.deepEqual(frame.panels[0].marks[0].at, [t, t * t, t / 2]);
  assert.deepEqual(frame.panels[1].patches[0].map([0, 0]), [t, 0, t / 2]);
  assert.equal(calls, 1, 'deferred material mapping retains the same evaluated dependency');
});

test('material anchors and traces preserve their common 3D relationship through seek', () => {
  const model = MathMorph.model({ t: 0 });
  const material = model.material(([u, v], { t }) => [u + t, v * t, t], {
    domain: [
      [0, 0],
      [1, 1],
    ],
  });
  const anchor = material.at([0.25, 0.5]);
  const traceStyle = { from: 0 };
  const trace = model.trace(anchor, 't', traceStyle);
  const plan = explain(model, [material, model.point(anchor), trace]);
  traceStyle.from = 9;
  const read = (p) => {
    const panel = plan.sample(p).panels[0];
    assert.equal(panel.space, '3d');
    assert.equal(panel.bounds[0].length, 3);
    const point = panel.marks[0].at;
    assert.deepEqual(panel.patches[0].map([0.25, 0.5]), point);
    assert.deepEqual(panel.paths[0].points[0], [0.25, 0, 0]);
    assert.deepEqual(panel.paths[0].points.at(-1), point);
    for (let axis = 0; axis < 3; axis++)
      assert.ok(panel.bounds[0][axis] <= point[axis] && panel.bounds[1][axis] >= point[axis]);
    return point;
  };
  const first = read(0.47);
  read(1);
  read(0.1);
  assert.deepEqual(read(0.47), first);
});

test('state and shared outputs are isolated from callbacks and caller-owned input arrays', () => {
  const initial = {
    t: 0,
    matrix: [
      [1, 0],
      [0, 1],
    ],
  };
  const model = MathMorph.model(initial);
  initial.matrix[0][0] = 99;
  const shared = model.value((state) => {
    assert.throws(() => {
      state.matrix[0][0] = 99;
    }, TypeError);
    return state.matrix;
  });
  const point = shared.map((matrix) => {
    assert.throws(() => {
      matrix[0][0] = 99;
    }, TypeError);
    return [matrix[0][0], matrix[1][1]];
  });
  const uv = [0.25, 0.5];
  const material = model.material(([u, v]) => [u, v], {
    domain: [
      [0, 0],
      [1, 1],
    ],
  });
  const fixed = material.at(uv);
  const joinInput = [2, 3];
  const joined = model.parameter('t').join(joinInput, (_, p) => p);
  const plan = explain(
    model,
    [model.point(point), model.point(fixed), model.point(joined)],
    undefined,
    {
      result: shared,
    },
  );
  uv[0] = 9;
  joinInput[0] = 9;
  const frame = plan.sample(1);
  assert.deepEqual(
    frame.panels[0].marks.map((mark) => mark.at),
    [
      [1, 1],
      [0.25, 0.5],
      [2, 3],
    ],
  );
  assert.deepEqual(frame.result, [
    [1, 0],
    [0, 1],
  ]);
  assert.throws(() => {
    frame.result[0][0] = 7;
  }, TypeError);
});

test('stage boundaries retain the completed state and reveal the result only in the final hold', () => {
  const model = MathMorph.model({
    t: 0,
    matrix: [
      [1, 0],
      [0, 1],
    ],
  });
  const point = model.value(({ t, matrix }) => [t, matrix[0][0], matrix[1][1]]);
  const plan = explain(
    model,
    [model.point(point)],
    [
      {
        to: {
          t: 1,
          matrix: [
            [2, 0],
            [0, 3],
          ],
        },
        explanation: 'First',
      },
      { to: { t: 2 }, explanation: 'Second' },
    ],
    { result: point },
  );
  assert.equal(plan.stages, 2);
  assert.deepEqual(plan.sample(0.49).panels[0].marks[0].at, plan.sample(0.5).panels[0].marks[0].at);
  assert.deepEqual(plan.sample(0.5).panels[0].marks[0].at, [1, 2, 3]);
  assert.equal(plan.sample(0.49).result, undefined);
  assert.equal(plan.sample(0.9).result, undefined);
  assert.deepEqual(plan.sample(1).result, [2, 2, 3]);
  assert.throws(() => plan.sample(NaN), /finite/i);
});

test('compiled explanations own their descriptors while preserving shared graph identity', () => {
  const model = MathMorph.model({ t: 0 });
  const domain = [
    [0, 0],
    [1, 1],
  ];
  const grid = [2, 3];
  const style = { domain, grid, text: 'A', pigment: 'blue' };
  const material = model.material(([u, v], { t }) => [u + t, v], style);
  const objects = [material];
  const panel = {
    title: 'Before',
    objects,
    bounds: [
      [-2, -2],
      [2, 2],
    ],
  };
  const step = { to: { t: 1 }, formula: model.parameter('t').map(String), explanation: 'Original' };
  const result = [1, 2];
  const spec = { panels: [panel], steps: [step], result };
  const plan = model.explain(spec);
  const before = plan.sample(0.4);
  domain[1][0] = 100;
  grid[0] = 24;
  style.text = 'B';
  style.pigment = 'orange';
  panel.title = 'After';
  panel.bounds[1][0] = 100;
  step.to.t = 10;
  step.formula = 'Changed';
  step.explanation = 'Changed';
  result[0] = 99;
  objects.length = 0;
  spec.steps.length = 0;
  spec.panels.length = 0;
  const after = plan.sample(0.4);
  const { map: firstMap, ...firstPatch } = before.panels[0].patches[0];
  const { map: nextMap, ...nextPatch } = after.panels[0].patches[0];
  assert.deepEqual(nextPatch, firstPatch);
  assert.deepEqual(nextMap([0.5, 0.5]), firstMap([0.5, 0.5]));
  assert.deepEqual(after.panels[0].bounds, before.panels[0].bounds);
  assert.equal(after.panels[0].title, 'Before');
  assert.equal(after.formula, before.formula);
  assert.equal(after.explanation, 'Original');
  assert.deepEqual(plan.sample(1).result, [1, 2]);
  assert.throws(() => {
    plan.result[0] = 3;
  }, TypeError);
});

test('measurements use all spatial coordinates regardless of endpoint order', () => {
  const model = MathMorph.model({ t: 0 });
  const plan = explain(model, [model.measure([0, 0], [0, 0, 3]), model.measure([0, 0, 3], [0, 0])]);
  const panel = plan.sample(0.4).panels[0];
  assert.equal(panel.space, '3d');
  assert.deepEqual(
    panel.labels.map((label) => label.text),
    ['3', '3'],
  );
  close(panel.labels[0].to[2], 3);
});

test('invalid tensors, domains and cross-model relationships fail at preparation', () => {
  const model = MathMorph.model({
    t: 0,
    matrix: [
      [1, 0],
      [0, 1],
    ],
  });
  const point = model.point([0, 0]);
  assert.throws(
    () => explain(model, [point], [{ to: { matrix: [1, 2] }, explanation: '' }]),
    /shape/i,
  );
  assert.throws(
    () => explain(model, [point], [{ to: { t: Infinity }, explanation: '' }]),
    /finite/i,
  );
  assert.throws(
    () => explain(model, [point], [{ to: { unknown: 1 }, explanation: '' }]),
    /unknown/i,
  );
  const other = MathMorph.model({ t: 0 });
  assert.throws(() => model.point(other.value(() => [0, 0])), /same model/i);
  assert.throws(
    () => explain(model, [other.curve((t) => [t, 0], { domain: [0, 1] })]),
    /same model/i,
  );
  assert.throws(
    () =>
      explain(model, [
        other.material(([u, v]) => [u, v], {
          domain: [
            [0, 0],
            [1, 1],
          ],
        }),
      ]),
    /same model/i,
  );
  for (const domain of [
    [
      [0, 0],
      [0, 1],
    ],
    [
      [0, 0, 0],
      [1, 1, 1],
    ],
    [[0], [1]],
  ])
    assert.throws(() => explain(model, [model.material(() => [0, 0], { domain })]), /domain/i);
  for (const grid of [[2], [2, 3, 4], [0, 2], [2, Infinity]])
    assert.throws(
      () =>
        explain(model, [
          model.material(() => [0, 0], {
            domain: [
              [0, 0],
              [1, 1],
            ],
            grid,
          }),
        ]),
      /grid/i,
    );
  assert.throws(
    () =>
      model.explain({
        panels: [{ title: '', space: '2d', objects: [model.point([0, 0, 1])] }],
        steps: [{ to: { t: 1 }, explanation: '' }],
      }),
    /3D/,
  );
});

test('automatic framing preserves visual scale when mathematical units change', () => {
  const bounds = (unit) => {
    const model = MathMorph.model({ t: 0 });
    return model
      .explain({
        panels: [
          {
            title: 'A physical sheet',
            objects: [
              model.material(([u, v]) => [u * unit, v * unit, 0], {
                domain: [
                  [-2, -1],
                  [2, 1],
                ],
              }),
            ],
          },
        ],
        steps: [{ to: { t: 1 }, explanation: '' }],
      })
      .sample(0.5)
      .panels[0].bounds.flat()
      .map((value) => value / unit);
  };
  const reference = bounds(1);
  for (const unit of [1e-6, 1e6])
    bounds(unit).forEach((value, index) => assert.ok(Math.abs(value - reference[index]) < 1e-9));
});

test('curve preparation preserves every oscillation instead of aliasing a periodic curve to a line', () => {
  const model = MathMorph.model({ t: 0 });
  const wave = (t) => 0.15 * Math.sin(384 * Math.PI * t);
  const plan = explain(model, [model.curve((t) => [t, wave(t)], { domain: [0, 1] })]);
  const points = plan.sample(0.4).panels[0].paths[0].points;
  assert.deepEqual(points[0], [0, 0]);
  close(points.at(-1)[0], 1);
  let crests = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    assert.ok(x > points[i - 1][0], 'curve parameters retain their order');
    if (y > 0.14 && y > points[i - 1][1] && y > points[i + 1][1]) crests++;
  }
  assert.equal(crests, 192, 'all mathematical periods remain visible');
  // Independently measure distance to the delivered polyline, including between
  // its vertices. Amplitude alone would miss incorrectly joined oscillations.
  let segment = 1,
    worst = 0;
  for (let i = 0; i <= 49152; i++) {
    const x = i / 49152,
      y = wave(x);
    while (segment < points.length - 1 && points[segment][0] < x) segment++;
    const a = points[segment - 1],
      b = points[segment];
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      vx = x - a[0],
      vy = y - a[1];
    const along = Math.max(0, Math.min(1, (vx * dx + vy * dy) / (dx * dx + dy * dy)));
    worst = Math.max(worst, Math.hypot(vx - along * dx, vy - along * dy));
  }
  assert.ok(worst < 0.001, `geometric error relative to the unit domain: ${worst}`);
});

test('a moving curve uses one prepared topology with deterministic seek and no playback refinement', () => {
  const model = MathMorph.model({ phase: 0 });
  let calls = 0;
  const plan = model.explain({
    panels: [
      {
        title: '',
        objects: [
          model.curve(
            (t, { phase }) => {
              calls++;
              return [t, 0.15 * Math.sin(384 * Math.PI * t + phase)];
            },
            { domain: [0, 1] },
          ),
        ],
      },
    ],
    steps: [{ to: { phase: 1 }, explanation: '' }],
  });
  const sample = (progress) => {
    const before = calls;
    const points = plan.sample(progress).panels[0].paths[0].points;
    assert.equal(calls - before, points.length, 'each displayed coordinate is evaluated once');
    assert.ok(points.every((p) => p.every(Number.isFinite)));
    assert.ok(Math.max(...points.map((p) => p[1])) > 0.149);
    return points;
  };
  const before = sample(0.37),
    parameters = before.map((p) => p[0]);
  for (const progress of [1, 0, 0.7, 0.17])
    assert.deepEqual(
      sample(progress).map((p) => p[0]),
      parameters,
    );
  assert.deepEqual(sample(0.37), before);
});

test('preparation catches curvature that appears between narrative states', () => {
  const model = MathMorph.model({ phase: 0 });
  const plan = model.explain({
    panels: [
      {
        title: '',
        objects: [
          model.curve(
            (t, { phase }) => [
              t,
              0.15 * Math.sin(16 * Math.PI * phase) * Math.sin(384 * Math.PI * t),
            ],
            { domain: [0, 1] },
          ),
        ],
      },
    ],
    steps: [{ to: { phase: 1 }, formula: model.parameter('phase').map(String), explanation: '' }],
  });
  // Seek the state through the public plan instead of coupling the test to its easing.
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 50; i++) {
    const progress = (lo + hi) / 2;
    if (Number(plan.sample(progress).formula) < 1 / 32) lo = progress;
    else hi = progress;
  }
  const frame = plan.sample((lo + hi) / 2);
  close(Number(frame.formula), 1 / 32);
  const points = frame.panels[0].paths[0].points;
  assert.ok(
    Math.max(...points.map((p) => p[1])) > 0.149,
    'a genuine intermediate wave cannot collapse to a straight line',
  );
});
