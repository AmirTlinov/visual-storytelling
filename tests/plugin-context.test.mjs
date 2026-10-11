import test from 'node:test';
import assert from 'node:assert/strict';
import { frameContext } from '../plugin/ui/frame-context.mjs';
import { presentSession, toolResult } from '../plugin/mcp/presentation.mjs';

const session = { sessionId: 'shown', buildRevision: 'build-1' };
const report = {
  stateRevision: 2,
  state: { time: 1, mode: 'explore', cue: { id: 'move', action: 'Move the object' } },
  checkpoint: { time: 1, cue: 'move', mode: 'explore', values: { x: 3 } },
};

test('model-facing sessions summarize every job state without changing full job or app payloads', () => {
  const statuses = [
    'queued',
    'running',
    'cancelling',
    'failed',
    'cancelled',
    'interrupted',
    'succeeded',
  ];
  const jobs = statuses.map((status, index) => ({
    id: `job-${index}`,
    kind: index === 6 ? 'review' : 'build',
    status,
    stage: `Stage ${index}`,
    sourceRevision: `source-${index}`,
    ...(status === 'running' && { progress: { done: 2, total: 8, frames: ['internal-frame'] } }),
    ...(status === 'failed' && { error: 'Failure details '.repeat(100) }),
    ...(status === 'cancelled' && { supersededBy: 'job-6' }),
    target: { kind: 'working', projectId: 'project', checkpoint: { values: { x: 4 } } },
    authored: { files: ['scene.js'], entry: 'scene.js' },
    toolchain: { path: '/private/runtime' },
    result: {
      buildRevision: `build-${index}`,
      source: { path: '/private/snapshot', revision: `source-${index}` },
      paths: Array.from(
        { length: 20 },
        (_, frame) => `/artifacts/review-${index}/frame-${frame}.png`,
      ),
      onion: { frames: Array(50).fill({ time: 3, image: 'frame.png', values: { x: 4 } }) },
    },
  }));
  const raw = {
    sessionId: 'shown',
    title: 'Shown scene',
    jobs,
    state: { time: 3, duration: 10, mode: 'explore', parameters: { x: 4 } },
    checkpoint: { time: 3, mode: 'explore', values: { x: 4 } },
  };
  const original = structuredClone(raw);
  for (const detail of ['state', 'model', 'timeline', 'presentation']) {
    const observation = presentSession(raw, detail);
    assert.deepEqual(
      observation.jobs.map(({ status }) => status),
      statuses,
    );
    assert.deepEqual(observation.jobs[1].progress, { done: 2, total: 8 });
    assert.equal(observation.jobs[3].error, jobs[3].error.slice(0, 600));
    assert.equal(observation.jobs[3].errorTruncated, true);
    assert.equal(observation.jobs[4].supersededBy, 'job-6');
    assert.equal(observation.jobs[6].sourceRevision, 'source-6');
    assert.equal(observation.jobs[6].buildRevision, 'build-6');
    assert.equal(observation.jobs[6].result, undefined);
    assert.equal(observation.jobs[6].target, undefined);
    assert.equal(observation.jobs[6].authored, undefined);
    assert.equal(observation.jobs[6].toolchain, undefined);
    assert.match(observation.jobsHint, /story_inspect\(jobId\)/);
    assert.deepEqual(observation.checkpoint, raw.checkpoint);
    assert.deepEqual(observation.state.parameters, raw.state.parameters);
    assert.ok(
      Buffer.byteLength(JSON.stringify(observation)) < Buffer.byteLength(JSON.stringify(raw)) / 3,
    );
    assert.deepEqual(toolResult(observation).structuredContent.jobs, observation.jobs);
  }
  const listed = presentSession({ sessionId: 'shown', jobs });
  assert.equal(listed.jobs.length, jobs.length);
  assert.equal(listed.jobs[6].result, undefined, 'unobserved listed sessions are compact too');
  assert.deepEqual(raw, original, 'full runtime jobs and the app-only session remain unchanged');
  assert.deepEqual(presentSession({ sessionId: 'shown', jobs: [] }).jobs, []);
  assert.equal(presentSession({ sessionId: 'shown', jobs: [] }).jobsHint, undefined);
});

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
      time: 8.4,
      cue: 'cue',
      mode: 'explore',
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

test('context keeps the retained picture, time, condition and cue together after failed preparation', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const updates = [];
  const context = frameContext({ updateModelContext: async (value) => updates.push(value) }, {});
  const checkpoint = { time: 0, cue: 'first', mode: 'story', values: { x: 1 } };
  const retained = presentSession({
    checkpoint,
    state: {
      time: 6,
      duration: 10,
      mode: 'story',
      review: {
        cues: [
          { id: 'first', start: 0, end: 5, action: 'First drawing' },
          { id: 'second', start: 5, end: 10, action: 'Second drawing' },
        ],
      },
      rendering: { phase: 'failed', requested: { time: 6 }, presented: { time: 0 } },
    },
  });
  context.update(session, { ...retained, stateRevision: 3, renderStatus: 'failed' });
  t.mock.timers.tick(120);
  await Promise.resolve();
  const observation = updates[0].structuredContent.visualStory;
  assert.equal(observation.time, 0);
  assert.equal(observation.mode, 'story');
  assert.deepEqual(observation.parameters, { x: 1 });
  assert.deepEqual(observation.cue, { id: 'first', label: 'First drawing' });
  await context.close();
});
