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

test('reports and acknowledgements cannot consume commands belonging to the poll channel', async (t) => {
  const { directory, session, view } = await fixture(t);
  const pending = request(directory, session.id, {
    op: 'control',
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
  const first = { op: 'control', requestId: 'first-action', commands: [{ type: 'seek', time: 4 }] };
  const pending = request(directory, session.id, first);
  assert.equal(
    directory.request(session.id, {
      commands: [{ time: 4, type: 'seek' }],
      requestId: 'first-action',
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

test('deadline checks reject late acknowledgements even before the timer callback runs', async (t) => {
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  const { directory, session, view } = await fixture(t, { timeout: 100, rendererTimeout: 10000 });
  const args = { op: 'control', requestId: 'expired-action', commands: [{ type: 'play' }] };
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
  await assert.rejects(directory.request(session.id, { op: 'inspect' }), /still opening/);
  await directory.exchange({ ...view, report: report(), wait: false });
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
