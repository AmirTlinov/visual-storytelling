import { spawn } from 'node:child_process';
import { open, mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { assertMotionOutput } from './report.mjs';

/** A recorder job owns one output directory; it never owns the user's UI executor. */
export async function startRecording(input, out, options = {}) {
  if (!options.window && !options.cdp && options.headed === undefined)
    options = { ...options, headed: true };
  out = resolve(out);
  await assertMotionOutput(out);
  await mkdir(out, { recursive: true });
  const file = join(out, 'recording-job.json');
  if ((await readdir(out)).length) throw new Error('Use an empty recording directory');
  const state = { status: 'starting', input, out, options, started: new Date().toISOString() };
  await writeFile(file, JSON.stringify(state), { flag: 'wx' });
  const log = await open(join(out, 'recorder.log'), 'a');
  const worker = spawn(
    process.execPath,
    [fileURLToPath(new URL('./record-worker.mjs', import.meta.url)), file],
    {
      detached: true,
      stdio: ['ignore', log.fd, log.fd],
    },
  );
  worker.on('error', async (error) => {
    await writeFile(file, JSON.stringify({ ...state, status: 'failed', error: error.message }));
  });
  worker.unref();
  await log.close();
  const started = performance.now();
  while (performance.now() - started < 20000) {
    const current = JSON.parse(await readFile(file, 'utf8'));
    if (current.status === 'failed') throw new Error(current.error);
    if (current.status !== 'starting')
      return {
        status: current.status,
        session: out,
        stop: `visual-story review stop '${out.replaceAll("'", "'\\''")}'`,
        statusCommand: `visual-story review status '${out.replaceAll("'", "'\\''")}'`,
      };
    await delay(100);
  }
  return {
    status: 'starting',
    session: out,
    statusCommand: `visual-story review status '${out.replaceAll("'", "'\\''")}'`,
  };
}

export async function recordingStatus(out, stop = false) {
  out = resolve(out);
  const state = JSON.parse(await readFile(join(out, 'recording-job.json'), 'utf8'));
  if (stop && ['starting', 'recording'].includes(state.status))
    await writeFile(join(out, 'stop-recording'), 'stop\n', { flag: 'wx' }).catch((e) => {
      if (e.code !== 'EEXIST') throw e;
    });
  const { options, ...result } = state;
  if (state.pid && ['starting', 'recording', 'analyzing'].includes(state.status)) {
    try {
      process.kill(state.pid, 0);
    } catch (e) {
      if (e.code === 'ESRCH')
        Object.assign(result, {
          status: 'interrupted',
          recovery: `visual-story review inspect '${out.replaceAll("'", "'\\''")}'`,
          error: 'Recorder exited before finalizing; saved raw frames remain available.',
        });
    }
  }
  return { ...result, ...(stop ? { stopRequested: true } : {}) };
}
