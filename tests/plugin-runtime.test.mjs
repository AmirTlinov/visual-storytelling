import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { connectRuntime } from '../plugin/runtime/client.mjs';
import { readJSON, writeJSON } from '../plugin/runtime/storage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const checkpoint = (time) => ({ time, progress: 0, mode: 'explore', values: { x: 3 } });
const report = (stateRevision, time) => ({
  stateRevision,
  checkpoint: checkpoint(time),
  state: {
    time,
    duration: 30,
    mode: 'explore',
    playing: false,
    parameters: [{ key: 'x', value: 3 }],
    capabilities: ['pause', 'seek'],
  },
});
const live = (sessionId, renderer, generation) => ({ sessionId, renderer, generation });

async function direct(directory, data) {
  const previous = process.env.VISUAL_STORY_DATA_DIR;
  process.env.VISUAL_STORY_DATA_DIR = data;
  try {
    return await connectRuntime(directory);
  } finally {
    if (previous === undefined) delete process.env.VISUAL_STORY_DATA_DIR;
    else process.env.VISUAL_STORY_DATA_DIR = previous;
  }
}

async function gone(pid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') return;
      throw error;
    }
    await delay(25);
  }
  throw new Error('The idle runtime did not stop.');
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'story-runtime-'));
  const data = join(directory, 'data');
  await mkdir(data);
  const clients = new Set(),
    kernels = new Set();
  t.after(async () => {
    await Promise.allSettled([...clients].map((client) => client.close()));
    for (const pid of kernels) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
      }
    }
    await Promise.allSettled([...kernels].map(gone));
    await rm(directory, { recursive: true, force: true });
  });
  await Promise.all([
    build({
      entryPoints: [join(root, 'plugin/mcp/server.mjs')],
      outfile: join(directory, 'server.mjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      banner: {
        js: "import { createRequire } from 'node:module';const require=createRequire(import.meta.url);",
      },
    }),
    build({
      entryPoints: [join(root, 'plugin/runtime/kernel.mjs')],
      outfile: join(directory, 'kernel.mjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
    }),
    writeFile(join(directory, 'app.html'), '<main>Runtime contract fixture</main>'),
    writeJSON(join(directory, 'example.json'), {
      revision: 'runtime-fixture',
      title: 'Runtime fixture',
      html: '<main>scene</main>',
    }),
  ]);
  async function stdio() {
    const client = new Client({ name: 'runtime-contract', version: '1' });
    clients.add(client);
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [join(directory, 'server.mjs')],
        stderr: 'inherit',
        env: { ...process.env, VISUAL_STORY_DATA_DIR: data },
      }),
    );
    return client;
  }
  async function runtime() {
    const client = await direct(directory, data);
    clients.add(client);
    kernels.add((await client.call('hello')).pid);
    return client;
  }
  return { directory, data, stdio, runtime };
}

async function tool(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  assert.equal(result.isError, undefined, JSON.stringify(result));
  return result.structuredContent;
}
const view = (client, state, args = {}) =>
  tool(client, 'story_view', { ...state, action: 'exchange', ...args });
const ready = (client, state, revision, time) =>
  view(client, state, { report: report(revision, time), wait: false });
const ack = (client, state, id, revision, time) =>
  view(client, state, {
    report: report(revision, time),
    acknowledgements: [{ id, result: { time } }],
    wait: false,
  });

test(
  'independent stdio clients share commands and one handoff owner, including after a persisted restart',
  { timeout: 20000 },
  async (t) => {
    const f = await fixture(t);
    let [a, b] = await Promise.all([f.stdio(), f.stdio()]);
    let runtime = await f.runtime();
    const hello = await runtime.call('hello');
    runtime.close();
    const opened = await tool(a, 'story_open');
    assert.equal(
      (await tool(b, 'story_open', { sessionId: opened.sessionId })).serverInstance,
      opened.serverInstance,
    );
    const rendererA = randomUUID();
    const attachedA = await tool(a, 'story_view', {
      sessionId: opened.sessionId,
      renderer: rendererA,
      action: 'attach',
    });
    const first = live(opened.sessionId, rendererA, attachedA.generation);
    await ready(a, first, 0, 0);
    const control = b.callTool({
      name: 'story_control',
      arguments: {
        sessionId: opened.sessionId,
        buildRevision: opened.buildRevision,
        stateRevision: 0,
        requestId: randomUUID(),
        commands: [{ type: 'seek', time: 7 }],
      },
    });
    const delivery = await view(a, first);
    assert.equal(delivery.commands[0].op, 'control');
    await ack(a, first, delivery.commands[0].id, 1, 7);
    const controlled = await control;
    assert.equal(controlled.isError, undefined, JSON.stringify(controlled));
    assert.equal(controlled.structuredContent.state.time, 7);

    const rendererB = randomUUID(),
      rendererC = randomUUID();
    const toB = tool(b, 'story_view', {
      sessionId: opened.sessionId,
      renderer: rendererB,
      action: 'attach',
    });
    const stopA = await view(a, first);
    const toC = tool(a, 'story_view', {
      sessionId: opened.sessionId,
      renderer: rendererC,
      action: 'attach',
    });
    await ack(a, first, stopA.commands[0].id, 2, 7);
    const attachedB = await toB;
    const second = live(opened.sessionId, rendererB, attachedB.generation);
    await ready(b, second, 2, 7);
    const stopB = await view(b, second);
    assert.equal(stopB.commands[0].op, 'suspend');
    await ack(b, second, stopB.commands[0].id, 3, 17);
    const attachedC = await toC;
    assert.equal(attachedC.generation, attachedA.generation + 2);
    assert.deepEqual(attachedC.checkpoint, checkpoint(17));
    await Promise.all([a.close(), b.close()]);
    await gone(hello.pid);

    [a, b] = await Promise.all([f.stdio(), f.stdio()]);
    runtime = await f.runtime();
    assert.notEqual((await runtime.call('hello')).serverInstance, hello.serverInstance);
    runtime.close();
    // Both clients load the same persisted ID before either has opened it in this process.
    const renderers = [randomUUID(), randomUUID()];
    const attaches = [a, b].map((client, index) =>
      tool(client, 'story_view', {
        sessionId: opened.sessionId,
        renderer: renderers[index],
        action: 'attach',
      }),
    );
    const winner = await Promise.race(
      attaches.map((promise, index) => promise.then((attached) => ({ index, attached }))),
    );
    assert.equal(winner.attached.generation, attachedC.generation + 1);
    assert.deepEqual(winner.attached.checkpoint, checkpoint(17));
    const client = [a, b][winner.index];
    const winningView = live(opened.sessionId, renderers[winner.index], winner.attached.generation);
    await ready(client, winningView, 3, 17);
    const stop = await view(client, winningView);
    assert.equal(stop.commands[0].op, 'suspend');
    await ack(client, winningView, stop.commands[0].id, 4, 17);
    const restored = await attaches[1 - winner.index];
    assert.equal(restored.generation, attachedC.generation + 2);
    assert.deepEqual(restored.checkpoint, checkpoint(17));
  },
);

test(
  'a binary update keeps one owner, while client close rejects pending RPCs immediately',
  { timeout: 10000 },
  async (t) => {
    const f = await fixture(t);
    const runtime = await f.runtime();
    const hello = await runtime.call('hello');
    const entry = join(f.directory, 'kernel.mjs'),
      original = await readFile(entry, 'utf8');
    await writeFile(entry, original + '\n// a newer binary\n');
    await assert.rejects(direct(f.directory, f.data), /another plugin build/);
    assert.equal((await runtime.call('hello')).pid, hello.pid);
    await writeFile(entry, original);
    const reopened = await f.runtime();
    assert.equal((await reopened.call('hello')).serverInstance, hello.serverInstance);
    const opened = await runtime.call('open');
    const renderer = randomUUID();
    const attached = await runtime.call('attach', { sessionId: opened.sessionId, renderer });
    const state = live(opened.sessionId, renderer, attached.generation);
    await runtime.call('exchange', { ...state, report: report(0, 0), wait: false });
    const waiting = runtime.call('request', {
      sessionId: opened.sessionId,
      request: { op: 'inspect' },
    });
    runtime.close();
    await assert.rejects(waiting, /disconnected/);
    await assert.rejects(runtime.call('hello'), /disconnected/);
    assert.equal((await reopened.call('hello')).pid, hello.pid);
  },
);

test(
  'an early kernel exit reports startup failure and releases its startup lock',
  { timeout: 5000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'story-runtime-failed-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const data = join(directory, 'data');
    await writeFile(
      join(directory, 'kernel.mjs'),
      "throw new Error('deliberate startup failure');\n",
    );
    await assert.rejects(direct(directory, data), /exited during startup/);
    await assert.rejects(direct(directory, data), /exited during startup/);
  },
);

test('snapshot publication is private, complete and cleans failed temporary writes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-snapshot-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'session.json');
  await writeJSON(file, { revision: 1 });
  const cyclic = {};
  cyclic.self = cyclic;
  await assert.rejects(writeJSON(file, cyclic), /circular/i);
  assert.deepEqual(await readJSON(file), { revision: 1 });
  await Promise.all([writeJSON(file, { revision: 2 }), writeJSON(file, { revision: 3 })]);
  assert.ok([2, 3].includes((await readJSON(file)).revision));
  assert.equal((await stat(file)).mode & 0o077, 0);
  const blocked = join(directory, 'blocked');
  await mkdir(blocked);
  await assert.rejects(writeJSON(blocked, { revision: 4 }));
  assert.deepEqual((await readdir(directory)).sort(), ['blocked', 'session.json']);
});
