import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authoringTrials, manualConditionChange } from './plugin/authoring-trials.mjs';
const identity = {
  sessionId: 'scene',
  projectId: 'project',
  sourceRevision: 'source',
  generation: 1,
};
const beforeCondition = (values) => ({
  ...identity,
  at: Date.now(),
  playing: false,
  phase: 'ready',
  values,
});

test('authoring dataset retains every failed trial and requires 18 base plus 12 unfamiliar tasks', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'authoring-trials-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const owner = authoringTrials(out, {
    release: 'test-only',
    model: 'test',
    reasoning: 'test',
    hardware: {},
  });
  const client = {
    callTool: async () => ({
      structuredContent: { status: 'connected', context: 'observed-context' },
    }),
  };
  const families = [],
    domains = new Set();
  for (let i = 0; i < 30; i++) {
    const task = await owner.start({ context: 'observed-context' }, client);
    assert.equal(task.index, i);
    await assert.rejects(owner.start({ context: 'observed-context' }, client), /Finish the active/);
    assert(!Object.hasOwn(task, 'inputs'));
    assert(!Object.hasOwn(task, 'document'));
    families.push(task.family);
    if (i >= 18) domains.add(task.domain);
    const result = await owner.finish({ capturedAt: Date.now(), error: 'injected author failure' });
    assert.equal(result.timingPassed, false);
    assert.equal(result.computedStateCorrect, false);
    assert.equal(result.completed, i + 1);
  }
  assert.deepEqual(
    families.slice(0, 18).reduce((m, k) => ((m[k] = (m[k] ?? 0) + 1), m), {}),
    { division: 6, lever: 6, probability: 6 },
  );
  assert.equal(domains.size, 4);
  const summary = JSON.parse(await readFile(join(out, 'summary.json'), 'utf8'));
  assert.equal(summary.complete, true);
  assert.equal(summary.trials.length, 30);
  assert(summary.trials.every((x) => x.error === 'injected author failure'));
  await assert.rejects(owner.start({ context: 'observed-context' }, client), /dataset is complete/);
});

test('trial transitions and durable reports reject forged clocks and retain malformed evidence', async (t) => {
  const out = await mkdtemp(join(tmpdir(), 'authoring-boundaries-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const metadata = { release: 'test', model: 'test', reasoning: 'test', hardware: {} };
  const owner = authoringTrials(out, metadata);
  const client = {
    callTool: async () => ({ structuredContent: { status: 'connected', context: 'observed' } }),
  };
  const starts = await Promise.allSettled([
    owner.start({ context: 'observed' }, client),
    owner.start({ context: 'observed' }, client),
  ]);
  assert.equal(starts.filter((x) => x.status === 'fulfilled').length, 1);
  assert.match(starts.find((x) => x.status === 'rejected').reason.message, /transition/);
  let task = starts.find((x) => x.status === 'fulfilled').value;
  let r = await owner.finish({ capturedAt: task.start - 1, interactionAt: task.start - 1 });
  assert.equal(r.evidenceValid, false);
  assert.equal(r.timingPassed, false);
  task = await owner.start({ context: 'observed' }, client);
  r = await owner.finish({ capturedAt: Date.now() + 60000, interactionAt: Date.now() + 60000 });
  assert.equal(r.evidenceValid, false);
  assert.equal(r.timingPassed, false);
  task = await owner.start({ context: 'observed' }, client);
  assert.equal(task.family, 'probability');
  const scores = task.task
    .match(/равны ([\d/-]+),/)[1]
    .split('/')
    .map(Number);
  const values = { scoreA: scores[0], scoreB: scores[1], scoreC: scores[2], temperature: 1 };
  const result = { structuredContent: { state: { snapshot: { ...values, trace: {} } } } };
  owner.record(
    { name: 'story_control', arguments: { commands: [{ type: 'parameters' }] } },
    result,
    Date.now(),
  );
  const now = Date.now();
  r = await owner.finish({
    capturedAt: now,
    interactionAt: now,
    observations: { initial: { ...values, trace: {} }, changed: { ...values, trace: {} } },
    authored: {
      models: [{ module: 'probability', inputs: values }],
      chapters: [{ beats: [{}, {}] }],
    },
  });
  assert.equal(r.computedStateCorrect, false);
  const report = JSON.parse(await readFile(join(out, 'trial-2.json'), 'utf8'));
  assert.equal(typeof report.checkError, 'string');
  assert(report.checkError.length > 0);
  const before = await readFile(join(out, 'summary.json'), 'utf8');
  await assert.rejects(authoringTrials(out, metadata).start({ context: 'observed' }, client), {
    code: 'EEXIST',
  });
  assert.equal(await readFile(join(out, 'summary.json'), 'utf8'), before);
});

test('comparison grading follows the changed after case and cannot accept a balanced before in its place', async (t) => {
  const { leverModel } = await import('../dist/index.js');
  for (const balanceAfter of [true, false]) {
    const out = await mkdtemp(join(tmpdir(), 'authoring-comparison-'));
    t.after(() => rm(out, { recursive: true, force: true }));
    const owner = authoringTrials(out, {
      release: 'test',
      model: 'test',
      reasoning: 'test',
      hardware: {},
    });
    const client = {
      callTool: async () => ({ structuredContent: { status: 'connected', context: 'observed' } }),
    };
    await owner.start({ context: 'observed' }, client);
    await owner.finish({ error: 'unit test skips division' });
    const task = await owner.start({ context: 'observed' }, client);
    const m = task.task.match(/слева (\d+)Н на плече (\d+)см, справа (\d+)Н на плече (\d+)см/);
    const inputs = { leftForce: +m[1], leftArm: +m[2], rightForce: +m[3], rightArm: +m[4] };
    const changed = {
      ...inputs,
      rightForce: (inputs.leftForce * inputs.leftArm) / inputs.rightArm,
    };
    const model = { id: 'lever', module: 'lever', inputs };
    const part = (v) => ({ inputs: v, state: leverModel.staticState(v, model) });
    const initial = { comparison: { before: part(inputs), after: part(inputs) } };
    const final = {
      comparison: {
        before: part(balanceAfter ? inputs : changed),
        after: part(balanceAfter ? changed : inputs),
      },
    };
    for (const [snapshot, value] of [
      [initial, inputs.rightForce],
      [final, changed.rightForce],
    ]) {
      const before = beforeCondition({ comparisonValue: inputs.rightForce });
      owner.record(
        {
          name: 'story_control',
          arguments: {
            commands: [{ type: 'parameters', values: { comparisonValue: changed.rightForce } }],
          },
        },
        {
          structuredContent: {
            ...identity,
            state: { snapshot, rendering: { presented: { values: { comparisonValue: value } } } },
          },
        },
        before.at,
        before,
      );
    }
    const now = Date.now();
    const report = await owner.finish({
      capturedAt: now,
      interactionAt: now,
      observations: { initial, changed: final },
      conditions: {
        initial: { at: task.start, values: { comparisonValue: inputs.rightForce } },
        changed: { at: now, values: { comparisonValue: changed.rightForce } },
      },
      authored: {
        models: [{ module: 'lever-comparison', inputs }],
        chapters: [{ beats: [{}, {}] }],
      },
    });
    assert.equal(report.computedStateCorrect, balanceAfter);
    assert.equal(report.evidenceValid, true);
  }
});

test('route grading follows the presented inputs and flat subject trace', async (t) => {
  const { instructionalRouteModel } = await import('../dist/index.js');
  const out = await mkdtemp(join(tmpdir(), 'authoring-route-'));
  t.after(() => rm(out, { recursive: true, force: true }));
  const owner = authoringTrials(out, {
    release: 'test',
    model: 'test',
    reasoning: 'test',
    hardware: {},
  });
  const client = {
    callTool: async () => ({ structuredContent: { status: 'connected', context: 'observed' } }),
  };
  for (let i = 0; i < 21; i++) {
    await owner.start({ context: 'observed' }, client);
    await owner.finish({ error: 'unit test skips earlier questions' });
  }
  const task = await owner.start({ context: 'observed' }, client);
  const orderId = task.task.match(/Заказ(\d+)/)[1];
  const initialInputs = instructionalRouteModel.validateInputs({
    orderId,
    reserve: 'shared',
    'disabled-provider': true,
  });
  const changedInputs = { ...initialInputs, reserve: 'independent' };
  const initial = instructionalRouteModel.staticState(initialInputs).trace;
  const changed = instructionalRouteModel.staticState(changedInputs).trace;
  for (const [snapshot, values] of [
    [initial, initialInputs],
    [changed, changedInputs],
  ]) {
    const before = beforeCondition(initialInputs);
    owner.record(
      { name: 'story_control', arguments: { commands: [{ type: 'parameters', values }] } },
      {
        structuredContent: {
          ...identity,
          state: { snapshot, rendering: { presented: { values } } },
        },
      },
      before.at,
      before,
    );
  }
  const now = Date.now();
  const report = await owner.finish({
    capturedAt: now,
    interactionAt: now,
    observations: { initial, changed },
    conditions: {
      initial: { at: task.start, values: initialInputs },
      changed: { at: now, values: changedInputs },
    },
    authored: {
      models: [{ module: 'dependency-route', inputs: initialInputs }],
      chapters: [{ beats: [{}, {}] }],
    },
  });
  assert.equal(report.computedStateCorrect, true);
  assert.equal(report.evidenceValid, true);
});

test('manual evidence rejects no-op, view-only, stale, failed and unmatched patches', () => {
  const initial = { at: 100, values: { count: 11, divisor: 3, comparisonCase: 'before' } };
  const changed = { at: 200, values: { count: 12, divisor: 3, comparisonCase: 'before' } };
  const patch = (values = { count: 12 }, presented = changed.values) => ({
    name: 'story_control',
    start: 120,
    end: 150,
    before: { ...beforeCondition(initial.values), at: 125 },
    arguments: { commands: [{ type: 'parameters', values }] },
    result: {
      structuredContent: {
        ...identity,
        state: { rendering: { presented: { values: presented } } },
      },
    },
  });
  assert.deepEqual(manualConditionChange(initial, changed, [patch()]), {
    keys: ['count'],
    complete: true,
  });
  for (const [after, calls] of [
    [{ ...changed, values: initial.values }, [patch({ count: 11 }, initial.values)]],
    [
      { ...changed, values: { ...initial.values, comparisonCase: 'after' } },
      [patch({ comparisonCase: 'after' })],
    ],
    [changed, [patch({ divisor: 3 })]],
    [changed, [patch({ count: 12 }, initial.values)]],
    [changed, [{ ...patch(), result: { isError: true } }]],
    [changed, [{ ...patch(), start: 50, end: 90 }]],
    [changed, [{ ...patch(), start: 210, end: 220 }]],
    [changed, [{ ...patch(), arguments: { commands: [{ type: 'seek', time: 2 }] } }]],
    [
      changed,
      [
        {
          ...patch(),
          arguments: {
            commands: [
              { type: 'seek', time: 2 },
              { type: 'parameters', values: { count: 12 } },
            ],
          },
        },
      ],
    ],
    [changed, [{ ...patch(), before: { ...patch().before, values: changed.values } }]],
    [changed, [{ ...patch(), before: { ...patch().before, sessionId: 'other' } }]],
    [changed, [{ ...patch(), before: { ...patch().before, generation: 2 } }]],
    [changed, [{ ...patch(), before: { ...patch().before, playing: true } }]],
    [changed, [{ ...patch(), before: { ...patch().before, phase: 'preparing' } }]],
    [{ ...changed, values: { ...changed.values, divisor: 4 } }, [patch()]],
  ])
    assert.equal(manualConditionChange(initial, after, calls).complete, false);
  assert.equal(manualConditionChange(undefined, changed, [patch()]).complete, false);
  const intermediate = { ...changed.values, count: 12 },
    final = { ...changed.values, count: 13 };
  assert.equal(
    manualConditionChange(initial, { at: 300, values: final }, [
      patch({ count: 12 }, intermediate),
      {
        ...patch({ count: 13 }, final),
        start: 160,
        end: 180,
        before: { ...patch().before, at: 165, values: intermediate },
      },
    ]).complete,
    true,
    'successive manual steps remain a proven chain',
  );
});
