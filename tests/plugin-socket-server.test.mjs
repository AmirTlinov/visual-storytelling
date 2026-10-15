import test from 'node:test';
import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runtimeSocketServer } from '../plugin/runtime/socket-server.mjs';

async function fixture(t, operations) {
  const directory = await mkdtemp(join(tmpdir(), 'story-socket-'));
  const state = { closing: false, updating: false };
  const server = runtimeSocketServer({
    operations,
    isClosing: () => state.closing,
    isUpdating: () => state.updating,
    onConnect() {},
    onActivity() {},
  });
  await server.listen(join(directory, 'runtime.sock'));
  const socket = connect(join(directory, 'runtime.sock'));
  await once(socket, 'connect');
  const reader = createInterface({ input: socket });
  const lines = reader[Symbol.asyncIterator]();
  t.after(async () => {
    socket.destroy();
    reader.close();
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    state,
    server,
    socket,
    send(id, method, params = {}) {
      socket.write(JSON.stringify({ id, method, params }) + '\n');
    },
    async reply() {
      const line = await lines.next();
      assert.equal(line.done, false, 'runtime returns a complete reply');
      return JSON.parse(line.value);
    },
  };
}

test(
  'socket protocol frames split and batched requests and preserves structured failures',
  { timeout: 5000 },
  async (t) => {
    const f = await fixture(t, {
      hello: ({ text }) => ({ text }),
      edit() {
        throw Object.assign(new Error('Changed source.'), {
          code: 'stale_source',
          field: 'sourceRevision',
          current: 'next',
          action: 'inspect',
        });
      },
    });
    f.socket.write('{"id":"split","method":"hello","params":{"text":"при');
    f.socket.write('вет"}}\n{"id":"unknown","method":"toString"}\n');
    const replies = [await f.reply(), await f.reply()];
    assert.deepEqual(
      replies.find((reply) => reply.id === 'split'),
      { id: 'split', result: { text: 'привет' } },
    );
    assert.deepEqual(
      replies.find((reply) => reply.id === 'unknown'),
      {
        id: 'unknown',
        error: { code: 'operation_failed', message: 'Unknown runtime operation.' },
      },
    );
    f.send('edit', 'edit');
    assert.deepEqual(await f.reply(), {
      id: 'edit',
      error: {
        code: 'stale_source',
        message: 'Changed source.',
        field: 'sourceRevision',
        current: 'next',
        action: 'inspect',
      },
    });
    f.socket.write('invalid JSON\n');
    assert.equal((await f.reply()).error.code, 'operation_failed');
    f.send('still-open', 'hello', { text: 'ready' });
    assert.equal((await f.reply()).result.text, 'ready');
  },
);

test(
  'retirement refuses new edits while in-flight work and frame reports drain on their owner',
  { timeout: 5000 },
  async (t) => {
    const edit = Promise.withResolvers(),
      poll = Promise.withResolvers();
    const editStarted = Promise.withResolvers(),
      pollStarted = Promise.withResolvers();
    const f = await fixture(t, {
      hello: () => ({ protocol: 1 }),
      edit() {
        editStarted.resolve();
        return edit.promise;
      },
      exchange({ wait }) {
        if (!wait) return { applied: true };
        pollStarted.resolve();
        return poll.promise;
      },
    });
    t.after(() => {
      edit.resolve();
      poll.resolve();
    });
    f.send('accepted-edit', 'edit');
    f.send('pending-report', 'exchange', { wait: true });
    await Promise.all([editStarted.promise, pollStarted.promise]);
    assert.equal(f.server.connectionCount, 1);
    assert.equal(f.server.workCount, 1, 'long polls do not delay retirement as authored work');
    f.state.updating = true;
    f.send('refused-edit', 'edit');
    assert.equal((await f.reply()).error.code, 'RUNTIME_UPDATE_REQUIRED');
    f.send('report', 'exchange', { wait: false });
    assert.deepEqual(await f.reply(), { id: 'report', result: { applied: true } });
    let drained = false;
    const drain = f.server.drain().then(() => {
      drained = true;
    });
    edit.resolve({ receipt: 'saved' });
    assert.deepEqual(await f.reply(), { id: 'accepted-edit', result: { receipt: 'saved' } });
    assert.equal(f.server.workCount, 0);
    assert.equal(drained, false, 'shutdown waits for the frame report as well');
    poll.resolve({ observed: true });
    assert.deepEqual(await f.reply(), { id: 'pending-report', result: { observed: true } });
    await drain;
    assert.equal(drained, true);
    f.state.closing = true;
    f.send('late', 'hello');
    assert.equal((await f.reply()).error.message, 'Runtime shutting down.');
  },
);
