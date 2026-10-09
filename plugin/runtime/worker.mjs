import { workflows } from '../workflows.mjs';
import { configureEnvironment } from '../../tools/environment.mjs';
const abort = new AbortController();
let running = false;
process.on('message', async (message) => {
  if (message.type === 'cancel') {
    abort.abort(new Error('Preparation cancelled.'));
    return;
  }
  if (running) return;
  running = true;
  let terminal;
  try {
    if (!Object.hasOwn(workflows, message.kind)) throw new Error('Unsupported preparation.');
    await configureEnvironment(message.input.data);
    const result = await workflows[message.kind](message.input, {
      jobId: message.jobId,
      signal: abort.signal,
      progress: (stage, progress) => process.send?.({ type: 'progress', stage, progress }),
      authored: (project) => process.send?.({ type: 'authored', project }),
    });
    abort.signal.throwIfAborted();
    terminal = { type: 'result', result };
  } catch (error) {
    terminal = { type: 'error', error: error.message, cancelled: abort.signal.aborted };
  }
  try {
    // Large results span several IPC writes. Keep the channel open until all bytes are sent.
    await new Promise((resolve, reject) => {
      process.send(terminal, (error) => (error ? reject(error) : resolve()));
    });
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    if (process.connected) process.disconnect();
  }
});
