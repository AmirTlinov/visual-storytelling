import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { authoringContext, contextualRuntime } from '../plugin/mcp/authoring-context.mjs';

test('contexts survive restart, reject tampering and cannot move between data owners', async (t) => {
  const path = await mkdtemp(join(tmpdir(), 'authoring-context-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const [codec, concurrent] = await Promise.all([authoringContext(path), authoringContext(path)]);
  const reference = [
    'project',
    'source',
    'scene',
    'build',
    3,
    2,
    'instance',
    { version: 'exact-pin' },
  ];
  const context = codec.encode(reference);
  assert.deepEqual(concurrent.decode(context), reference);
  assert.deepEqual((await authoringContext(path)).decode(context), reference);
  const altered = context.replace('v1.', 'v2.');
  assert.throws(() => codec.decode(altered), { code: 'invalid_context' });
  assert.throws(() => codec.decode(context.slice(0, -8) + 'AAAAAAAA'), { code: 'invalid_context' });
  const other = await authoringContext(join(path, 'other'));
  assert.throws(() => other.decode(context), { code: 'invalid_context' });
});

test('the transport keeps working source, displayed build and observed generation separate', async (t) => {
  const path = await mkdtemp(join(tmpdir(), 'authoring-context-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const codec = await authoringContext(path);
  const context = codec.encode(['project', 'working-B', 'scene', 'shown-A', 3, 2, 'owner', null]);
  const calls = [];
  const historical = {
    sessionId: 'scene',
    projectId: 'project',
    sourceRevision: 'source-A',
    buildRevision: 'shown-A',
    stateRevision: 4,
    generation: 2,
    serverInstance: 'owner',
    acknowledgement: 'rendered',
  };
  const runtime = contextualRuntime(
    {
      call: async (method, args) => {
        calls.push({ method, args });
        return historical;
      },
    },
    codec,
  );
  await runtime.call('edit', {
    context,
    requestId: 'authoring-request',
    changes: [{ path: 'scene.js', content: 'B' }],
  });
  assert.equal(calls[0].args.sourceRevision, 'working-B');
  assert.equal(calls[0].args.context, undefined);
  await runtime.call('produce', {
    target: { kind: 'build', context },
    options: { conditions: 'current' },
  });
  assert.equal(calls[1].args.target.buildRevision, 'shown-A');
  assert.equal(calls[1].args.options.sessionId, 'scene');
  await runtime.call('produce', { target: { kind: 'working', context } });
  assert.equal(calls[2].args.target.sourceRevision, 'working-B');
  const request = {
    context,
    request: { op: 'control', requestId: 'control-request', commands: [{ type: 'seek', time: 2 }] },
  };
  const observed = await runtime.call('request', request);
  assert.equal(calls[3].args.request.expectedGeneration, 2);
  assert.equal(calls[3].args.request.expectedInstance, 'owner');
  assert.deepEqual(codec.decode(observed.context).slice(0, 7), [
    'project',
    'working-B',
    'scene',
    'shown-A',
    4,
    2,
    'owner',
  ]);
  assert.deepEqual(
    await runtime.call('request', request),
    observed,
    'historical output signs its own observation',
  );
});

test('completed preparation binds its accepted project rather than the job identity', async (t) => {
  const path = await mkdtemp(join(tmpdir(), 'authoring-context-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const codec = await authoringContext(path);
  const project = {
    id: 'accepted-project',
    path: '/project',
    files: { 'scene.js': {} },
    sourceRevision: 'accepted-source',
    buildRevision: 'verified',
  };
  const runtime = contextualRuntime(
    {
      call: async () => ({
        id: 'job',
        projectId: project.id,
        sourceRevision: 'old-source',
        status: 'succeeded',
        result: { project, buildRevision: 'verified' },
      }),
    },
    codec,
  );
  const job = await runtime.call('job', { jobId: 'job' });
  assert.deepEqual(codec.decode(job.context).slice(0, 2), [project.id, project.sourceRevision]);
  assert.deepEqual(codec.decode(job.result.project.context).slice(0, 4), [
    project.id,
    project.sourceRevision,
    null,
    'verified',
  ]);
});

test('an accepted file candidate retains the independently displayed build in the next context', async (t) => {
  const path = await mkdtemp(join(tmpdir(), 'authoring-context-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const codec = await authoringContext(path);
  const context = codec.encode(['project', 'source-A', 'scene', 'shown-A', 4, 2, 'owner', null]);
  const runtime = contextualRuntime(
    {
      call: async () => ({
        project: {
          id: 'project',
          path: '/project',
          files: {},
          sourceRevision: 'source-B',
          buildRevision: 'prepared-B',
        },
        delivery: 'pending',
      }),
    },
    codec,
  );
  const next = await runtime.call('edit', {
    context,
    requestId: 'source-edit',
    changes: [{ path: 'scene.js', content: 'B' }],
  });
  assert.deepEqual(codec.decode(next.context).slice(0, 7), [
    'project',
    'source-B',
    'scene',
    'shown-A',
    4,
    2,
    'owner',
  ]);
});

test('creation context and state use its acknowledged destination instead of the reserved closed receipt', async (t) => {
  const path = await mkdtemp(join(tmpdir(), 'authoring-context-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const codec = await authoringContext(path);
  const context = codec.encode(['old-project', 'old-source', 'old-scene', 'old-build', 3, 2, 'owner', null]);
  const scene = { sessionId: 'new-scene', projectId: 'new-project', sourceRevision: 'new-source',
    buildRevision: 'new-build', generation: 1, serverInstance: 'owner', stateRevision: 0,
    status: 'connected', state: { snapshot: { count: 23, divisor: 5 } }, acknowledgement: 'rendered' };
  const runtime = contextualRuntime({ call: async () => ({
    ...scene, generation: 0, status: 'closed', state: null,
    project: { id: 'new-project', path: '/project', files: {}, sourceRevision: 'new-source' },
    delivery: 'shown', shown: [scene],
  }) }, codec);
  const created = await runtime.call('create', { context, title: 'Group', requestId: 'create-request',
    document: { recipe: 'division', inputs: { count: 23, divisor: 5 } } });
  assert.equal(created.status, 'connected');
  assert.deepEqual(created.state, scene.state);
  assert.equal(codec.decode(created.context)[5], 1);
  assert.equal(codec.decode(created.context)[2], 'new-scene');
  assert.deepEqual(created.difference.created.inputs, { count: 23, divisor: 5 });
});
