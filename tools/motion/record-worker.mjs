import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { reviewMotion } from './review.mjs';

const path = process.argv[2],
  job = JSON.parse(await readFile(path, 'utf8'));
let writes = Promise.resolve();
function status(next) {
  writes = writes.then(async () => {
    Object.assign(job, next);
    await writeFile(path + '.tmp', JSON.stringify(job));
    await rename(path + '.tmp', path);
  });
  return writes;
}

try {
  await status({ pid: process.pid });
  const result = await reviewMotion({
    input: job.input ?? '.',
    out: job.out,
    capture: {
      ...job.options,
      seconds: job.options.seconds ?? 3600,
      stopFile: join(job.out, 'stop-recording'),
      onReady: () => status({ status: 'recording' }),
      onCaptured: () => status({ status: 'analyzing' }),
    },
  });
  await status({ status: 'complete', result, finished: new Date().toISOString() });
} catch (error) {
  await status({ status: 'failed', error: error.message, finished: new Date().toISOString() });
}
