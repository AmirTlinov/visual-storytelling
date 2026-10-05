import { connect } from 'node:net';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, lstat, writeFile, open, realpath, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const protocol = 1;
const uid = process.getuid();
export const dataDirectory = () =>
  process.env.VISUAL_STORY_DATA_DIR ??
  join(homedir(), 'Library/Application Support/Visual Storytelling');

async function privateDirectory(path, resolveLinks = false) {
  await mkdir(path, { recursive: true, mode: 0o700 });
  if (resolveLinks) path = await realpath(path);
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== uid)
    throw new Error('Runtime directory has an unexpected owner or type.');
  await chmod(path, 0o700);
  return realpath(path);
}

function rpc(socket) {
  socket.setEncoding('utf8');
  let buffer = '',
    closed = false;
  const pending = new Map();
  function rejectAll(error = new Error('Local runtime disconnected. Reopen the project.')) {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    pending.clear();
  }
  socket.on('data', (chunk) => {
    buffer += chunk;
    if (buffer.length > 32_000_000) {
      socket.destroy(new Error('Runtime response is too large.'));
      return;
    }
    let end;
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      try {
        const message = JSON.parse(line),
          request = pending.get(message.id);
        if (!request) continue;
        pending.delete(message.id);
        clearTimeout(request.timer);
        message.error !== undefined
          ? request.reject(
              Object.assign(
                new Error(message.error.message ?? message.error ?? 'Local operation failed.'),
                message.error,
              ),
            )
          : request.resolve(message.result);
      } catch (error) {
        socket.destroy(error);
        return;
      }
    }
  });
  socket.on('error', (error) => rejectAll(error));
  socket.on('close', () => {
    closed = true;
    rejectAll();
  });
  return {
    get closed() {
      return closed || socket.destroyed || socket.writableEnded;
    },
    call(method, params = {}, timeout = 20000) {
      if (closed || socket.destroyed || socket.writableEnded)
        return Promise.reject(new Error('Local runtime disconnected.'));
      const id = randomUUID();
      let message;
      try {
        message = JSON.stringify({ id, method, params }) + '\n';
      } catch (error) {
        return Promise.reject(error);
      }
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error('Local operation did not respond.'));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        socket.write(message, (error) => {
          if (!error || !pending.has(id)) return;
          pending.delete(id);
          clearTimeout(timer);
          reject(error);
        });
      });
    },
    close() {
      if (closed) return;
      closed = true;
      rejectAll();
      socket.destroy();
    },
  };
}

/** Discovery stays available when an older installed runtime needs to be reconnected. */
export function runtimeClient(serverDirectory) {
  let connection,
    closed = false;
  const open = () =>
    (connection ??= connectRuntime(serverDirectory).catch((error) => {
      connection = undefined;
      throw error;
    }));
  return {
    async call(...args) {
      if (closed) throw new Error('Local runtime disconnected.');
      let pending = open(),
        client = await pending;
      if (client.closed && !closed) {
        if (connection === pending) connection = undefined;
        pending = open();
        client = await pending;
      }
      if (closed) throw new Error('Local runtime disconnected.');
      try {
        return await client.call(...args);
      } catch (error) {
        // The caller decides whether to repeat an operation whose acknowledgement was lost.
        if (client.closed && connection === pending) connection = undefined;
        throw error;
      }
    },
    close() {
      closed = true;
      void connection?.then(
        (client) => client.close(),
        () => {},
      );
    },
  };
}

/** Each host stdio process connects to one local owner over a user-only Unix socket. */
export async function connectRuntime(serverDirectory) {
  const data = await privateDirectory(dataDirectory(), true);
  const entry = join(serverDirectory, 'kernel.mjs');
  const build = createHash('sha256')
    .update(await readFile(entry))
    .digest('hex');
  // Binary changes share the endpoint; the handshake prevents two owners of persisted sessions.
  const identity = createHash('sha256').update(`${protocol}\0${data}`).digest('hex').slice(0, 20);
  const ipc = await privateDirectory(`/tmp/visual-story-${uid}`);
  const socketPath = join(ipc, identity + '.sock'),
    lock = socketPath + '.lock';
  const deadline = Date.now() + 12000;
  async function dial() {
    const info = await lstat(socketPath).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info && (!info.isSocket() || info.uid !== uid))
      throw new Error('Runtime socket has an unexpected owner or type.');
    const socket = await new Promise((resolve, reject) => {
      const candidate = connect(socketPath);
      const timer = setTimeout(
        () => candidate.destroy(new Error('Runtime connection timed out.')),
        1000,
      );
      candidate.once('connect', () => {
        clearTimeout(timer);
        candidate.removeListener('error', failed);
        resolve(candidate);
      });
      function failed(error) {
        clearTimeout(timer);
        candidate.destroy();
        ['ENOENT', 'ECONNREFUSED'].includes(error.code) ? resolve(null) : reject(error);
      }
      candidate.once('error', failed);
    });
    if (!socket) return null;
    const client = rpc(socket);
    try {
      const hello = await client.call('hello', {}, 1500);
      if (hello.protocol !== protocol || hello.build !== build) {
        const error = new Error(
          'The local runtime belongs to another plugin build. Close Visual Storytelling panels and reconnect the plugin to finish updating.',
        );
        error.code = 'RUNTIME_VERSION_CONFLICT';
        error.action = 'Close Visual Storytelling panels and reconnect the plugin, then retry.';
        throw error;
      }
      return client;
    } catch (error) {
      client.close();
      if (error.code === 'RUNTIME_VERSION_CONFLICT') throw error;
      // A kernel already closing its last connection cannot accept this client.
      if (/disconnected|shutting down|EPIPE|ECONNRESET/.test(error.message)) return null;
      throw error;
    }
  }
  let client = await dial(),
    lockToken;
  try {
    while (!client && Date.now() < deadline) {
      try {
        await mkdir(lock, { mode: 0o700 });
        lockToken = randomUUID();
        try {
          await writeFile(
            join(lock, 'owner.json'),
            JSON.stringify({ pid: process.pid, token: lockToken }),
            { mode: 0o600, flag: 'wx' },
          );
        } catch (error) {
          await rm(lock, { recursive: true, force: true });
          lockToken = undefined;
          throw error;
        }
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const info = await lstat(lock).catch((failure) => {
          if (failure.code === 'ENOENT') return null;
          throw failure;
        });
        if (info && (!info.isDirectory() || info.uid !== uid))
          throw new Error('Runtime startup lock has an unexpected owner or type.');
        let owner;
        try {
          owner = JSON.parse(await readFile(join(lock, 'owner.json'), 'utf8'));
        } catch (failure) {
          if (failure.code !== 'ENOENT' && !(failure instanceof SyntaxError)) throw failure;
        }
        let abandoned = !owner && info && Date.now() - info.mtimeMs > 12000;
        if (Number.isSafeInteger(owner?.pid) && owner.pid > 0) {
          try {
            process.kill(owner.pid, 0);
          } catch (failure) {
            if (failure.code === 'ESRCH') abandoned = true;
            else if (failure.code !== 'EPERM') throw failure;
          }
        }
        if (abandoned) await rm(lock, { recursive: true, force: true });
      }
      if (lockToken) {
        client = await dial();
        if (client) break;
        const info = await lstat(socketPath).catch((error) => {
          if (error.code === 'ENOENT') return null;
          throw error;
        });
        if (info && (!info.isSocket() || info.uid !== uid))
          throw new Error('Runtime socket has an unexpected owner or type.');
        if (info) await rm(socketPath);
        const logPath = join(data, 'runtime.log');
        const log = await open(logPath, 'a', 0o600);
        let startupError;
        try {
          const child = spawn(process.execPath, [entry, socketPath, data], {
            detached: true,
            stdio: ['ignore', log.fd, log.fd],
            env: process.env,
          });
          child.once('error', (error) => {
            startupError = error;
          });
          child.once('exit', (code, signal) => {
            startupError ??= new Error(
              `Local runtime exited during startup (${signal ?? code}). Diagnostics: ${logPath}`,
            );
          });
          await new Promise((resolve, reject) => {
            child.once('spawn', resolve);
            child.once('error', reject);
          });
          child.unref();
        } finally {
          await log.close();
        }
        while (!client && Date.now() < deadline) {
          if (startupError) throw startupError;
          await delay(50);
          client = await dial();
        }
        break;
      }
      await delay(50);
      client = await dial();
    }
  } finally {
    if (lockToken) {
      const owner = await readFile(join(lock, 'owner.json'), 'utf8')
        .then(JSON.parse)
        .catch(() => null);
      if (owner?.token === lockToken) await rm(lock, { recursive: true, force: true });
    }
  }
  if (!client)
    throw new Error(`The local runtime did not start. Diagnostics: ${join(data, 'runtime.log')}`);
  return client;
}
