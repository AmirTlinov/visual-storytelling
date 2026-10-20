import { createServer } from 'node:net';
import { errorData } from '../errors.mjs';

// Existing render reports/ACKs and preparation observation finish on their current owner.
const updateOperations = new Set([
  'hello',
  'prepareUpdate',
  'job',
  'cancel',
  'exchange',
  'detach',
  'widget',
  'list',
  'project',
  'shownSource',
]);
const pollingOperations = new Set(['hello', 'prepareUpdate', 'exchange', 'job', 'list']);

/** Own wire framing and pending RPCs; domain state stays with the supplied operations. */
export function runtimeSocketServer({ operations, isClosing, isUpdating, onConnect, onActivity }) {
  const connections = new Set(),
    active = new Set(),
    work = new Set();
  const server = createServer((socket) => {
    if (isClosing()) {
      socket.destroy();
      return;
    }
    onConnect();
    connections.add(socket);
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 32_000_000) {
        socket.destroy();
        return;
      }
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        let method;
        const operation = (async () => {
          let id;
          try {
            if (isClosing()) throw new Error('Runtime shutting down.');
            const request = JSON.parse(line);
            id = request.id;
            method = request.method;
            if (!Object.hasOwn(operations, request.method))
              throw new Error('Unknown runtime operation.');
            if (isUpdating() && !updateOperations.has(request.method))
              throw Object.assign(new Error('The installed runtime is changing.'), {
                code: 'RUNTIME_UPDATE_REQUIRED',
                action:
                  'Reconnect Visual Storytelling in this chat after the current preparation finishes.',
              });
            const result = await operations[request.method](request.params);
            if (!socket.destroyed) socket.write(JSON.stringify({ id, result }) + '\n');
          } catch (error) {
            if (!socket.destroyed)
              socket.write(JSON.stringify({ id, error: errorData(error) }) + '\n');
          }
        })();
        active.add(operation);
        if (!pollingOperations.has(method)) work.add(operation);
        const finished = () => {
          active.delete(operation);
          work.delete(operation);
          onActivity();
        };
        operation.then(finished, finished);
      }
    });
    socket.on('error', () => {});
    socket.on('close', () => {
      connections.delete(socket);
      onActivity();
    });
  });

  return {
    get connectionCount() {
      return connections.size;
    },
    get workCount() {
      return work.size;
    },
    listen(path) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(path, resolve);
      });
    },
    drain: () => Promise.allSettled([...active]),
    disconnect() {
      for (const socket of connections) socket.destroy();
    },
    async close() {
      const stopped = new Promise((resolve) => server.close(resolve));
      this.disconnect();
      await stopped;
    },
  };
}
