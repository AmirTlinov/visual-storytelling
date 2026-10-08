import { workflows } from '../workflows.mjs';
import { configureEnvironment } from '../environment.mjs';
const abort = new AbortController();
let running = false;
process.on('message', async (message) => {
  if (message.type === 'cancel') {
    abort.abort(new Error('Preparation cancelled.'));
    return;
  }
  if (running) return;
  running = true;
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
    process.send?.({ type: 'result', result });
  } catch (error) {
    process.send?.({ type: 'error', error: error.message, cancelled: abort.signal.aborted });
  } finally {
    process.disconnect?.();
  }
});
