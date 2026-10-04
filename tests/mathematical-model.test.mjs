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
