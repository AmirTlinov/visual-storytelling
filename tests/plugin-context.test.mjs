import test from 'node:test';
import assert from 'node:assert/strict';
import { frameContext } from '../plugin/ui/frame-context.mjs';

const session = { sessionId: 'shown', buildRevision: 'build-1' };
const report = {
  stateRevision: 2,
  state: { time: 1, mode: 'explore', cue: { id: 'move', action: 'Move the object' } },
  checkpoint: { values: { x: 3 } },
};

test('closing a replaced view clears its one context attachment, including an in-flight update', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const updates = [];
  let release;
  const context = frameContext(
    { updateModelContext: async (value) => updates.push(value) },
    {
      modelContext: {
        update: async (value) => {
          updates.push(value);
          return new Promise((resolve) => {
            release = resolve;
          });
        },
      },
    },
  );
  context.update(session, report);
  t.mock.timers.tick(120);
  const closing = context.close();
  release({ updateId: 'old-view-update' });
  await closing;
  assert.equal(updates.length, 2);
  assert.equal(updates[0].structuredContent.visualStory.sessionId, session.sessionId);
  assert.deepEqual(updates[1], { structuredContent: {} });
  context.update(session, report);
  t.mock.timers.tick(120);
  assert.equal(updates.length, 2, 'the replaced view cannot restore a stale attachment');
});

test('closing a user-dismissed attachment does not overwrite the new host context', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const updates = [];
  const context = frameContext({ updateModelContext: async (value) => updates.push(value) }, {});
  context.update(session, report);
  t.mock.timers.tick(120);
  await Promise.resolve();
  context.host({ 'openai/modelContext': null });
  await context.close();
  assert.equal(updates.length, 1);
});

test('the complete context payload stays within 1500 characters while retaining exact identities', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const updates = [];
  const context = frameContext({ updateModelContext: async (value) => updates.push(value) }, {});
  const owner = {
    sessionId: 's'.repeat(36),
    projectId: 'p'.repeat(36),
    buildRevision: 'b'.repeat(64),
  };
  const current = {
    stateRevision: 18,
    renderStatus: 'prepared',
    state: {
      time: 8.4,
      mode: 'explore',
      cue: { id: 'cue', action: 'A'.repeat(160) },
      selected: ['object' + 'o'.repeat(20)],
    },
    checkpoint: {
      values: Object.fromEntries(
        Array.from({ length: 8 }, (_, i) => ['parameter' + i, 'x'.repeat(100)]),
      ),
    },
  };
  context.update(owner, current);
  t.mock.timers.tick(120);
  await Promise.resolve();
  assert.ok(JSON.stringify(updates[0]).length <= 1500);
  const observation = updates[0].structuredContent.visualStory;
  assert.equal(observation.sessionId, owner.sessionId);
  assert.equal(observation.buildRevision, owner.buildRevision);
  assert.equal(observation.cue.id, current.state.cue.id);
  assert.equal(Object.keys(observation.parameters).length + observation.moreParameters, 8);
  context.update(owner, current);
  t.mock.timers.tick(120);
  await Promise.resolve();
  assert.equal(updates.length, 1, 'the same frame does not produce another attachment update');
  await context.close();
});
