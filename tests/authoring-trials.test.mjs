import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authoringTrials } from './plugin/authoring-trials.mjs';

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
    for (const snapshot of [initial, final])
      owner.record(
        {
          name: 'story_control',
          arguments: {
            commands: [{ type: 'parameters', values: { comparisonValue: changed.rightForce } }],
          },
        },
        { structuredContent: { state: { snapshot } } },
        Date.now(),
      );
    const now = Date.now();
    const report = await owner.finish({
      capturedAt: now,
      interactionAt: now,
      observations: { initial, changed: final },
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
  ])
    owner.record(
      { name: 'story_control', arguments: { commands: [{ type: 'parameters', values }] } },
      { structuredContent: { state: { snapshot, rendering: { presented: { values } } } } },
      Date.now(),
    );
  const now = Date.now();
  const report = await owner.finish({
    capturedAt: now,
    interactionAt: now,
    observations: { initial, changed },
    authored: {
      models: [{ module: 'dependency-route', inputs: initialInputs }],
      chapters: [{ beats: [{}, {}] }],
    },
  });
  assert.equal(report.computedStateCorrect, true);
  assert.equal(report.evidenceValid, true);
});
