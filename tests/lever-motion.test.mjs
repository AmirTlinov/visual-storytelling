import test from 'node:test';
import assert from 'node:assert/strict';
import R from '@dimforge/rapier2d-compat';
import { leverModel, leverMotion, leverSubject } from '../dist/index.js';
import {
  prepareIllustratedDocument,
  prepareStoryDocument,
  documentModelsAt,
  cueSheet,
} from '../dist/story/index.js';
const inputs = { leftForce: 4, leftArm: 30, rightForce: 3, rightArm: 20 };
const state = (value) => leverModel.staticState(value);

test('short drawing calibration bounds input resolution without narrowing force inputs', () => {
  const subject = leverSubject({ maxArm: 40.5 });
  const model = { id: 'lever', module: 'lever', inputs };
  const fields = subject.parameters(model);
  assert.equal(fields.find((field) => field.key === 'rightArm').max, 40);
  assert.equal(fields.find((field) => field.key === 'rightForce').max, 100);
  const current = { values: inputs, time: 1, playing: false };
  assert.throws(
    () => subject.resolveInput({ rightArm: 41 }, current, {}, {}, 'input'),
    /exceed 40cm/,
  );
  assert.deepEqual(subject.resolveInput({ rightArm: 40 }, current, {}, {}, 'input').values, {
    ...inputs,
    rightArm: 40,
  });
  assert.equal(current.values.rightArm, 20);
  assert.equal(
    leverSubject({ maxArm: 200 })
      .parameters(model)
      .find((field) => field.key === 'rightArm').max,
    100,
  );
});

test('lever replay retains sign, point-mass inertia, neutral balance and physical stops', () => {
  const a = state(inputs);
  assert(Math.abs(a.motion.inertia - (4 * 0.3 ** 2 + 3 * 0.2 ** 2) / 9.81) < 1e-12);
  assert.equal(leverMotion(a, 0).angle, 0);
  assert.equal(leverMotion(a, 0).status, 'held');
  assert.equal(leverMotion(a, 2).status, 'stop');
  assert(Math.abs(leverMotion(a, 2).angle - Math.PI / 10) < 1e-12);
  assert.equal(leverMotion(a, 2).angularVelocity, 0);
  for (const time of [0.01, 0.1, 0.2, 1, 2]) {
    const result = leverMotion(a, time);
    const scaled = leverMotion(state({ ...inputs, leftForce: 8, rightForce: 6 }), time);
    assert(Math.abs(result.angle - scaled.angle) < 1e-12);
    const mirror = leverMotion(
      state({ leftForce: 3, leftArm: 20, rightForce: 4, rightArm: 30 }),
      time,
    );
    assert(Math.abs(result.angle + mirror.angle) < 1e-12);
    assert(Math.abs(result.angularVelocity + mirror.angularVelocity) < 1e-12);
    assert(Math.abs(result.moment - 0.6 * Math.cos(result.angle)) < 1e-12);
  }
  for (const value of [
    { ...inputs, rightArm: 40 },
    { leftForce: 0, leftArm: 0, rightForce: 0, rightArm: 0 },
    { leftForce: 4, leftArm: 0, rightForce: 3, rightArm: 0 },
  ]) {
    const result = leverMotion(state(value), 2);
    assert.equal(result.status, 'balanced');
    assert.equal(result.angle, 0);
    assert.equal(result.angularVelocity, 0);
  }
  assert.throws(() => leverMotion(a, NaN));
  assert.throws(() => leverMotion(a, -1));
});

test('normalized replay agrees with independently stepped physical inertia and torque', async () => {
  await R.init();
  for (const value of [
    inputs,
    { leftForce: 10, leftArm: 40, rightForce: 9, rightArm: 50 },
    { leftForce: 99, leftArm: 100, rightForce: 100, rightArm: 99 },
    { leftForce: 1, leftArm: 1, rightForce: 0, rightArm: 0 },
  ]) {
    const source = state(value),
      inertia = source.motion.inertia;
    const torque =
      (value.leftForce * value.leftArm) / 100 - (value.rightForce * value.rightArm) / 100;
    const rate = Math.sqrt(Math.abs(torque) / inertia);
    if (!rate) continue;
    const world = new R.World({ x: 0, y: 0 });
    const body = world.createRigidBody(
      R.RigidBodyDesc.dynamic()
        .lockTranslations()
        .setCanSleep(false)
        .setAngularDamping(0)
        .setAdditionalMassProperties(1, { x: 0, y: 0 }, inertia),
    );
    const dt = 1 / (7680 * rate);
    world.timestep = dt;
    try {
      for (let i = 1; i <= 5000; i++) {
        body.resetTorques(false);
        body.addTorque(torque * Math.cos(body.rotation()), true);
        world.step();
        if (i % 250 !== 0) continue;
        const time = i * dt,
          observed = leverMotion(source, time);
        assert(
          Math.abs(observed.angle - body.rotation()) < 0.0002,
          JSON.stringify({ value, time, observed, reference: body.rotation() }),
        );
        assert(Math.abs(observed.angularVelocity - body.angvel()) < rate * 0.001);
        const kinetic = 0.5 * inertia * observed.angularVelocity ** 2;
        const potentialDrop = Math.abs(torque) * Math.sin(Math.abs(observed.angle));
        assert(Math.abs(kinetic - potentialDrop) < Math.abs(torque) * 0.0002);
      }
    } finally {
      world.free();
    }
  }
});

test('one lever document seeks deterministically and retains a viewer trial on the same physical clock', () => {
  const prepared = prepareIllustratedDocument({ recipe: 'lever', inputs });
  const { document, script } = prepared;
  const sheet = cueSheet(script);
  const at = (time, changed) =>
    documentModelsAt(
      document,
      sheet.at(time),
      changed ? { lever: changed } : {},
      {},
      { mode: changed ? 'explore' : 'story' },
    ).models.lever;
  assert.equal(at(0).time, 0);
  assert.equal(at(1).time, 1 / 3);
  assert.equal(at(8).time, 2);
  assert.deepEqual(at(0.2), at(0.2));
  assert(at(0.2).motion.angle > 0);
  assert.equal(at(1, { ...inputs, rightArm: 40 }).motion.angle, 0);
  assert.deepEqual(at(1), at(1));
});

test('physical progress is independent of reduced reveal and follows a shifted, retimed release', () => {
  const { document, script } = prepareIllustratedDocument({
    recipe: 'lever',
    inputs,
    chapters: [
      {
        id: 'custom',
        title: 'Опыт',
        beats: [
          { id: 'hold', seconds: 2 },
          { id: 'release', seconds: 4, operation: { model: 'lever', name: 'release' } },
          { id: 'watch', seconds: 1 },
        ],
      },
    ],
  });
  const sheet = cueSheet(script);
  for (const reduced of [false, true]) {
    for (const [time, expected] of [
      [0, 0],
      [2, 0],
      [3, 0.5],
      [4, 1],
      [7, 2],
    ]) {
      const result = documentModelsAt(document, sheet.at(time, reduced)).models.lever;
      assert.equal(result.time, expected);
      const experiment = documentModelsAt(
        document,
        sheet.at(time, reduced),
        { lever: { ...inputs, rightArm: 40 } },
        {},
        { mode: 'explore' },
      ).models.lever;
      assert.equal(experiment.time, expected);
      assert.equal(experiment.motion.angle, 0);
    }
  }
  const probe = {
    validateInputs: (v) => ({ n: v.n }),
    state: (values) => ({ ...values }),
    operations: { show: (previous, p) => ({ ...previous, observedProgress: p }) },
    validateViews() {},
    focusTargets: () => [],
  };
  const doc = {
    version: 2,
    models: [{ id: 'p', module: 'probe', inputs: { n: 1 } }],
    views: [{ id: 'view', kind: 'probe', model: 'p' }],
    chapters: [{ id: 'chapter', beats: [{ id: 'show', operation: { model: 'p', name: 'show' } }] }],
  };
  const frame = cueSheet({ duration: 2, cues: { 'chapter.show': { start: 0, end: 2 } } });
  assert.equal(
    documentModelsAt(doc, frame.at(0.5, true), {}, { probe }).models.p.observedProgress,
    1,
    'ordinary reveal owners keep their reduced-motion contract',
  );
  assert.equal(
    documentModelsAt(doc, frame.at(0.5, false), {}, { probe }).models.p.observedProgress,
    0.25,
  );
  const held = prepareIllustratedDocument({
    recipe: 'lever',
    inputs,
    chapters: [
      {
        id: 'held',
        title: 'Удерживаем',
        beats: [{ id: 'look', seconds: 2, text: 'Рассмотри грузы.' }],
      },
    ],
  });
  assert.equal(documentModelsAt(held.document, cueSheet(held.script).at(1)).models.lever.time, 0);
  assert.equal(
    prepareIllustratedDocument({ recipe: 'lever', inputs, chapters: [] }).document.chapters.length,
    0,
  );
});

test('an inactive lever remains a legal part of another model’s chapter', () => {
  const composed = prepareStoryDocument({
    version: 2,
    models: [
      { id: 'lever', module: 'lever', inputs },
      { id: 'circuit', module: 'circuit', inputs: { closed: false } },
    ],
    views: [
      { id: 'lever.view', kind: 'lever', model: 'lever' },
      { id: 'loop', kind: 'circuit', model: 'circuit' },
    ],
    chapters: [
      {
        id: 'switch',
        title: 'Замкнём ключ',
        views: ['loop'],
        beats: [{ id: 'close', operation: { model: 'circuit', name: 'close' }, seconds: 2 }],
      },
    ],
  });
  const models = documentModelsAt(composed.document, cueSheet(composed.script).at(2)).models;
  assert.equal(models.lever.time, 0);
  assert.equal(models.circuit.closed, true);
  assert.throws(
    () =>
      prepareIllustratedDocument({
        recipe: 'lever',
        inputs,
        chapters: [
          {
            id: 'repeat',
            title: 'Повтор',
            beats: [
              { id: 'a', operation: { model: 'lever', name: 'release' } },
              { id: 'b', operation: { model: 'lever', name: 'release' } },
            ],
          },
        ],
      }),
    /release once/,
  );
});
