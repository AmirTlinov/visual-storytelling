import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SessionDirectory } from '../plugin/session-directory.mjs';
import { command, viewReport, acknowledgement } from '../plugin/mcp/schema.mjs';

const build = { revision: 'build-1', title: 'An explanation', html: '<main>scene</main>' };
const report = (stateRevision = 0, time = 0) => ({
  stateRevision,
  state: { time, playing: false, parameters: [] },
  checkpoint: { time, progress: 0, mode: 'story', values: {} },
});
const connection = (sessionId, renderer, generation) => ({ sessionId, renderer, generation });

async function fixture(t, options = {}) {
  const directory = new SessionDirectory({
    timeout: 2000,
    rendererTimeout: 2000,
    pollTimeout: 5,
    ...options,
  });
  t.after(() => directory.close());
  const session = directory.open(build);
  const renderer = randomUUID();
  const attached = await directory.attach(session.id, renderer);
  const view = connection(session.id, renderer, attached.generation);
  await directory.exchange({ ...view, report: report(), wait: false });
  return { directory, session, view };
}

function request(directory, id, args) {
  const promise = directory.request(id, args);
  // Failures remain observable by assertions without an unhandled rejection during handoff.
  promise.catch(() => {});
  return promise;
}

async function acknowledge(directory, view, id, state = report(1, 4)) {
  return directory.exchange({
    ...view,
    report: state,
    acknowledgements: [{ id, result: state.state }],
    wait: false,
  });
}

test('recovery keeps its renderer and last frame, rejects uncertain commands, and cannot take over another view', async (t) => {
  const { directory, session, view } = await fixture(t);
  await directory.exchange({ ...view, report: report(2, 4), wait: false });
  const args = {
    op: 'control',
    buildRevision: build.revision,
    stateRevision: 2,
    requestId: 'uncertain-once',
    commands: [{ type: 'seek', time: 8 }],
  };
  const pending = request(directory, session.id, args);
  await directory.exchange(view);
  const recovered = await directory.recover({
    ...view,
    serverInstance: directory.instance,
    report: report(2, 4),
  });
  assert.equal(recovered.generation, view.generation);
  assert.equal(recovered.recovery, 'resume');
  assert.equal(recovered.state.time, 4);
  await assert.rejects(pending, /Connection interrupted/);
  await assert.rejects(directory.request(session.id, args), /Connection interrupted/);
  assert.deepEqual(
    (await directory.exchange(view)).commands,
    [],
    'an uncertain intent is never replayed',
  );
  await assert.rejects(
    directory.recover({ ...view, renderer: randomUUID(), serverInstance: directory.instance }),
    (error) => error.code === 'view_replaced',
  );
  const checkpoint = session.checkpoint;
  await directory.exchange({
    ...view,
    report: {
      stateRevision: 3,
      state: { time: 9, playing: false },
      renderStatus: 'failed',
      observationError: 'prepare failed',
    },
    wait: false,
  });
  assert.deepEqual(
    session.checkpoint,
    checkpoint,
    'failed preparation retains the last confirmed checkpoint',
  );
});

test('a persisted session reloads once after runtime restart without taking an attached owner', async (t) => {
  const { directory, session, view } = await fixture(t);
  const restarted = new SessionDirectory({ pollTimeout: 5 });
  t.after(() => restarted.close());
  const restored = restarted.open(build);
  Object.assign(restored, { generation: view.generation, checkpoint: report(2, 4).checkpoint });
  const input = { ...view, sessionId: restored.id, serverInstance: directory.instance };
  const result = await restarted.recover(input);
  assert.equal(result.recovery, 'reload');
  assert.equal(result.generation, view.generation + 1);
  assert.equal(result.checkpoint.time, 4);
  assert.equal(
    (await restarted.recover(input)).generation,
    result.generation,
    'lost recovery response does not attach twice',
  );
  await assert.rejects(
    restarted.recover({ ...input, renderer: randomUUID() }),
    (error) => error.code === 'view_replaced',
  );
});

test('reports and acknowledgements cannot consume commands belonging to the poll channel', async (t) => {
  const { directory, session, view } = await fixture(t);
  const pending = request(directory, session.id, {
    op: 'control',
    buildRevision: build.revision,
    stateRevision: 0,
    requestId: 'seek-once',
    commands: [{ type: 'seek', time: 4 }],
  });
  const update = await directory.exchange({ ...view, report: report(1, 2), wait: false });
  assert.deepEqual(update.commands, []);
  const polled = await directory.exchange(view);
  assert.equal(polled.commands.length, 1);
  assert.equal(polled.commands[0].id, 'seek-once');
  await acknowledge(directory, view, 'seek-once', report(2, 4));
  const result = await pending;
  assert.equal(result.acknowledgement, 'rendered');
  assert.equal(result.state.time, 4);
  assert.equal(result.stateRevision, 2);
});

test('request IDs survive many later commands and detach; reordered JSON is the same retry', async (t) => {
  const { directory, session, view } = await fixture(t);
  const first = {
    op: 'control',
    buildRevision: build.revision,
    stateRevision: 0,
    requestId: 'first-action',
    commands: [{ type: 'seek', time: 4 }],
  };
  const pending = request(directory, session.id, first);
  assert.equal(
    directory.request(session.id, {
      commands: [{ time: 4, type: 'seek' }],
      requestId: 'first-action',
      stateRevision: 0,
      buildRevision: build.revision,
      op: 'control',
    }),
    pending,
  );
  await directory.exchange(view);
  await acknowledge(directory, view, 'first-action');
  const result = await pending;
  await assert.rejects(
    directory.request(session.id, { ...first, commands: [{ type: 'pause' }] }),
    /different command/,
  );
  // Passing the former 128-receipt eviction boundary must not execute an old action again.
  for (let i = 0; i < 130; i++) {
    const id = `later-action-${i}`;
    const next = request(directory, session.id, {
      op: 'control',
      requestId: id,
      commands: [{ type: 'pause' }],
    });
    await directory.exchange(view);
    await acknowledge(directory, view, id);
    await next;
  }
  directory.detach(view);
  assert.equal(await directory.request(session.id, first), result);
  assert.equal(directory.describe(session).status, 'closed');
});

test('pause alone remains available without an inspection or with an outdated observation', async (t) => {
  const { directory, session, view } = await fixture(t);
  await directory.exchange({ ...view, report: report(5, 12), wait: false });
  for (const [index, observation] of [
    {},
    { buildRevision: 'older-build', stateRevision: 0 },
  ].entries()) {
    const id = `pause-without-inspect-${index}`;
    const pending = request(directory, session.id, {
      op: 'control',
      requestId: id,
      commands: [{ type: 'pause' }],
      ...observation,
    });
    const polled = await directory.exchange(view);
    assert.equal(polled.commands[0].id, id);
    await acknowledge(directory, view, id, report(6 + index, 12));
    assert.equal((await pending).acknowledgement, 'rendered');
  }
  await assert.rejects(
    directory.request(session.id, {
      op: 'control',
      commands: [{ type: 'pause' }, { type: 'seek', time: 4 }],
    }),
    (error) => error.code === 'revision_required',
  );
});

test('deadline checks reject late acknowledgements even before the timer callback runs', async (t) => {
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  const { directory, session, view } = await fixture(t, { timeout: 100, rendererTimeout: 10000 });
  const args = {
    op: 'control',
    buildRevision: build.revision,
    stateRevision: 0,
    requestId: 'expired-action',
    commands: [{ type: 'play' }],
  };
  const pending = request(directory, session.id, args);
  await directory.exchange(view);
  now += 101;
  await acknowledge(directory, view, args.requestId);
  await assert.rejects(pending, /deadline/);
  await assert.rejects(directory.request(session.id, args), /deadline/);
  const queued = request(directory, session.id, { op: 'inspect' });
  now += 101;
  const polled = await directory.exchange(view);
  assert.deepEqual(polled.commands, []);
  await assert.rejects(queued, /deadline/);
});

test('concurrent handoffs pause each owner and reject commands and reports from stale generations', async (t) => {
  const { directory, session, view } = await fixture(t);
  const rendererB = randomUUID(),
    rendererC = randomUUID();
  const attachB = directory.attach(session.id, rendererB);
  const attachC = directory.attach(session.id, rendererC);
  const fromA = await directory.exchange(view);
  assert.equal(fromA.commands[0].op, 'suspend');
  await assert.rejects(directory.request(session.id, { op: 'inspect' }), /moving/);
  await acknowledge(directory, view, fromA.commands[0].id, report(4, 12));
  const attachedB = await attachB;
  assert.equal(attachedB.restoration.reason, 'handoff');
  assert.equal(attachedB.checkpoint.time, 12);
  const viewB = connection(session.id, rendererB, attachedB.generation);
  assert.equal(attachedB.status, 'opening');
  // The next suspend must wait for B's first render, not reach an unmounted scene.
  const waitingB = directory.exchange(viewB);
  await directory.exchange({ ...viewB, report: report(4, 12), wait: false });
  const fromB = await waitingB;
  assert.equal(fromB.commands[0].op, 'suspend');
  await acknowledge(directory, viewB, fromB.commands[0].id, report(5, 12));
  const attachedC = await attachC;
  assert.equal(attachedC.generation, view.generation + 2);
  await assert.rejects(
    directory.exchange({ ...view, report: report(999, 99), wait: false }),
    /replaced/,
  );
  directory.detach(viewB);
  assert.equal(directory.describe(session).generation, attachedC.generation);
  assert.equal(directory.describe(session).state.time, 12);
});

test('a timed-out handoff keeps a recently connected owner available', async (t) => {
  const { directory, session, view } = await fixture(t, { timeout: 15, rendererTimeout: 10000 });
  await assert.rejects(directory.attach(session.id, randomUUID()), /deadline/);
  assert.equal(directory.describe(session).generation, view.generation);
  const pending = request(directory, session.id, { op: 'inspect' });
  const polled = await directory.exchange(view);
  assert.equal(polled.commands[0].op, 'inspect');
  await acknowledge(directory, view, polled.commands[0].id);
  await pending;
});

test('a superseded candidate resumes the paused owner without changing its build or generation', async (t) => {
  const { directory, session, view } = await fixture(t);
  session.nextBuild = { ...build, revision: 'candidate-a' };
  const replacing = directory.replace({ ...view, buildRevision: 'candidate-a' });
  const rejected = assert.rejects(replacing, /prepared build changed/);
  const suspend = (await directory.exchange(view)).commands[0];
  assert.equal(suspend.op, 'suspend');
  session.nextBuild = { ...build, revision: 'candidate-b' };
  await acknowledge(directory, view, suspend.id, report(7, 12));
  const resume = (await directory.exchange(view)).commands[0];
  assert.equal(resume.op, 'resume');
  await acknowledge(directory, view, resume.id, report(7, 12));
  await rejected;
  assert.equal(session.build.revision, build.revision);
  assert.equal(session.nextBuild.revision, 'candidate-b');
  assert.equal(session.generation, view.generation);
  assert.equal(session.checkpoint.time, 12);
  const inspection = request(directory, session.id, { op: 'inspect' });
  const command = (await directory.exchange(view)).commands[0];
  await acknowledge(directory, view, command.id, report(7, 12));
  assert.equal((await inspection).status, 'connected');
});

test('a candidate commits only after restoration, while abort preserves the current build and checkpoint', async (t) => {
  const { directory, session, view } = await fixture(t);
  session.nextBuild = { ...build, revision: 'candidate' };
  const preparing = directory.replace({ ...view, buildRevision: 'candidate', phase: 'prepare' });
  const suspended = (await directory.exchange(view)).commands[0];
  await acknowledge(directory, view, suspended.id, report(4, 9));
  const pending = await preparing;
  assert.equal(session.build.revision, build.revision);
  assert.equal(session.generation, view.generation);
  assert.equal(pending.checkpoint.time, 9);
  await assert.rejects(directory.attach(session.id, randomUUID()), /applying an update/);
  const aborted = directory.replace({
    ...view,
    buildRevision: 'candidate',
    phase: 'abort',
    replacementId: pending.replacementId,
  });
  const resume = (await directory.exchange(view)).commands[0];
  assert.equal(resume.op, 'resume');
  await acknowledge(directory, view, resume.id, report(4, 9));
  await aborted;
  assert.equal(session.build.revision, build.revision);
  assert.equal(session.generation, view.generation);
  assert.equal(session.handoff, false);
  const again = directory.replace({ ...view, buildRevision: 'candidate', phase: 'prepare' });
  await acknowledge(
    directory,
    view,
    (await directory.exchange(view)).commands[0].id,
    report(5, 11),
  );
  const ready = await again;
  const committed = await directory.replace({
    ...view,
    buildRevision: 'candidate',
    phase: 'commit',
    replacementId: ready.replacementId,
  });
  assert.equal(committed.buildRevision, 'candidate');
  assert.equal(committed.generation, view.generation + 1);
  assert.equal(committed.checkpoint.time, 11);
  assert.equal(session.replacement, undefined);
});

test('an abandoned prepared candidate resumes the previous owner and cannot later commit', async (t) => {
  const { directory, session, view } = await fixture(t, { timeout: 30, rendererTimeout: 2000 });
  session.nextBuild = { ...build, revision: 'candidate' };
  const preparing = directory.replace({ ...view, buildRevision: 'candidate' });
  await acknowledge(directory, view, (await directory.exchange(view)).commands[0].id, report(4, 9));
  const pending = await preparing;
  let resume;
  while (!resume)
    resume = (await directory.exchange(view)).commands.find((command) => command.op === 'resume');
  await acknowledge(directory, view, resume.id, report(4, 9));
  await session.replacement?.aborting;
  assert.equal(session.build.revision, build.revision);
  assert.equal(session.generation, view.generation);
  assert.equal(session.handoff, false);
  await assert.rejects(
    directory.replace({
      ...view,
      buildRevision: 'candidate',
      phase: 'commit',
      replacementId: pending.replacementId,
    }),
    /no longer available/,
  );
});

test('an expired renderer recovers its last checkpoint and fences off the former generation', async (t) => {
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  const { directory, session, view } = await fixture(t, { timeout: 10000, rendererTimeout: 8000 });
  await directory.exchange({ ...view, report: report(3, 17), wait: false });
  const pending = request(directory, session.id, { op: 'inspect' });
  now += 8001;
  assert.equal(directory.describe(session).status, 'unresponsive');
  const attached = await directory.attach(session.id, randomUUID());
  assert.equal(attached.restoration.reason, 'lease-expired');
  assert.equal(attached.restoration.checkpoint, 'last-confirmed');
  assert.equal(attached.checkpoint.time, 17);
  assert.equal(attached.generation, view.generation + 1);
  await assert.rejects(pending, /Renderer changed/);
  await assert.rejects(directory.exchange({ ...view, wait: false }), /replaced/);
});

test('opening, detach and shutdown cannot leave commands or long polls alive', async (t) => {
  const directory = new SessionDirectory({ pollTimeout: 10000 });
  t.after(() => directory.close());
  const session = directory.open(build),
    renderer = randomUUID();
  const attached = await directory.attach(session.id, renderer);
  const view = connection(session.id, renderer, attached.generation);
  const inspection = request(directory, session.id, { op: 'inspect' });
  let delivered = false;
  const opening = directory.exchange(view).then((value) => {
    delivered = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(delivered, false, 'opening must wait for the first rendered report');
  await directory.exchange({ ...view, report: report(), wait: false });
  const first = await opening;
  assert.equal(first.commands[0].op, 'inspect');
  await acknowledge(directory, view, first.commands[0].id, report());
  assert.equal((await inspection).acknowledgement, 'rendered');
  const polling = directory.exchange(view);
  directory.detach(view);
  await assert.rejects(polling, /replaced/);
  const reopened = await directory.attach(session.id, renderer);
  const nextView = connection(session.id, renderer, reopened.generation);
  await directory.exchange({ ...nextView, report: report(), wait: false });
  const pending = request(directory, session.id, { op: 'inspect' });
  await directory.exchange(nextView);
  const nextPoll = directory.exchange(nextView);
  directory.close();
  await assert.rejects(pending, /Server closed/);
  await assert.rejects(nextPoll, /replaced/);
  assert.throws(() => directory.open(build), /Server closed/);
  directory.close();
});

test('invalid or older reports cannot replace a confirmed checkpoint', async (t) => {
  const { directory, session, view } = await fixture(t);
  await directory.exchange({ ...view, report: report(2, 10), wait: false });
  await directory.exchange({ ...view, report: report(1, 3), wait: false });
  assert.equal(directory.describe(session).state.time, 10);
  await assert.rejects(
    directory.exchange({ ...view, report: { ...report(), stateRevision: Infinity }, wait: false }),
    /Invalid scene report/,
  );
  assert.equal(directory.describe(session).state.time, 10);
});

test('MCP schemas reject lossy command typos and malformed state envelopes', () => {
  assert.equal(command.safeParse({ type: 'pause', time: 2 }).success, false);
  assert.equal(command.safeParse({ type: 'seek', time: Infinity }).success, false);
  assert.equal(command.safeParse({ type: 'focus', ids: [' '] }).success, false);
  assert.equal(command.safeParse({ type: 'parameters', values: {} }).success, false);
  assert.deepEqual(command.parse({ type: 'cue', id: 'multiply', progress: 0.4 }), {
    type: 'cue',
    id: 'multiply',
    progress: 0.4,
  });
  assert.deepEqual(viewReport.parse(report(2, 4)), report(2, 4));
  assert.equal(viewReport.safeParse({ ...report(), checkpoint: [] }).success, false);
  assert.equal(acknowledgement.safeParse({ id: '' }).success, false);
});

test('a cold-scene execution failure preserves the completed command prefix through the delivery channel', async (t) => {
  const { directory, session, view } = await fixture(t);
  const pending = request(directory, session.id, {
    op: 'control',
    buildRevision: build.revision,
    stateRevision: 0,
    commands: [
      { type: 'seek', time: 4 },
      { type: 'focus', ids: ['missing'] },
    ],
  });
  const [command] = (await directory.exchange(view)).commands;
  await directory.exchange({
    ...view,
    wait: false,
    report: viewReport.parse({
      ...report(1, 4),
      state: { ...report(1, 4).state, snapshot: { payload: 'x'.repeat(300000) } },
      renderStatus: 'failed',
      observationError: 'Object is unavailable in this chapter.',
    }),
    acknowledgements: [
      acknowledgement.parse({
        id: command.id,
        error: 'Object is unavailable in this chapter.',
        failure: { code: 'scene_control_failed', commandIndex: 1, completedCommands: 1 },
      }),
    ],
  });
  await assert.rejects(
    pending,
    (error) =>
      error.code === 'scene_control_failed' &&
      error.completedCommands === 1 &&
      error.commandIndex === 1 &&
      error.current.stateRevision === 1 &&
      error.current.state.time === 4 &&
      error.current.state.snapshot === undefined &&
      error.current.renderStatus === 'failed' &&
      error.action === 'story_inspect',
  );
  const correction = request(directory, session.id, {
    op: 'control',
    buildRevision: build.revision,
    stateRevision: 1,
    commands: [{ type: 'seek', time: 0 }],
  });
  const [next] = (await directory.exchange(view)).commands;
  await acknowledge(directory, view, next.id, report(2, 0));
  const recovered = await correction;
  assert.equal(recovered.stateRevision, 2);
  assert.equal(recovered.renderStatus, 'rendered');
  assert.equal(recovered.observationError, undefined);
});
