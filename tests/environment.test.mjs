import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { withPreparationLock } from '../tools/environment/lock.mjs';

const execute = promisify(execFile);
const lockModule = new URL('../tools/environment/lock.mjs', import.meta.url).href;
const task = () => ({ signal: new AbortController().signal, progress() {} });

test(
  'a cancelled CLI releases its waiter while independent resources and dead-owner recovery remain safe',
  { timeout: 30000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-environment-lock-'));
    const lock = join(directory, 'environment', 'uv-0.11.3.lock');
    const holder = spawn(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
    import {withPreparationLock} from ${JSON.stringify(lockModule)};
    await withPreparationLock(process.argv[1], {signal:new AbortController().signal,progress(){}}, async()=>{
      process.send('ready');await new Promise(resolve=>process.once('message',resolve));
    });
  `,
        lock,
      ],
      { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    let cli;
    try {
      await once(holder, 'message');
      const env = { ...process.env };
      for (const key of Object.keys(env))
        if (key.startsWith('VISUAL_STORY_') || key.startsWith('UV_')) delete env[key];
      env.VISUAL_STORY_DATA_DIR = directory;
      cli = spawn(
        process.execPath,
        ['tools/scene.mjs', 'build', 'examples/logic-gates', '--out', join(directory, 'output')],
        { env, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      const closed = once(cli, 'close');
      let text = '';
      await new Promise((resolve, reject) => {
        cli.once('error', reject);
        cli.once('exit', (code) =>
          reject(new Error(`Build stopped before waiting: ${code}; ${text}`)),
        );
        cli.stderr.on('data', (bytes) => {
          text += bytes;
          if (text.includes('Ожидаю завершения')) resolve();
        });
      });
      cli.kill('SIGTERM');
      assert.equal((await closed)[0], 143);
      assert.match(text, /Build cancelled/);
      assert.equal(
        (await readdir(lock)).length,
        1,
        'the cancelled waiter leaves the active owner intact',
      );
      assert.equal(
        await withPreparationLock(
          join(directory, 'environment', 'higgs-other.lock'),
          task(),
          () => 42,
        ),
        42,
        'a different resource proceeds while uv preparation is held',
      );
      const exited = once(holder, 'exit');
      holder.kill('SIGKILL');
      await exited;
      let active = 0,
        overlap = false;
      const results = await Promise.all(
        Array.from({ length: 3 }, (_, index) =>
          withPreparationLock(lock, task(), async () => {
            overlap ||= ++active > 1;
            await delay(20);
            active--;
            return index;
          }),
        ),
      );
      assert.deepEqual(results, [0, 1, 2]);
      assert.equal(overlap, false, 'stale contenders never replace a new live owner');
      assert.deepEqual(await readdir(join(directory, 'environment')), []);
    } finally {
      if (cli?.exitCode === null) cli.kill('SIGKILL');
      if (holder.exitCode === null && holder.signalCode === null) holder.kill('SIGKILL');
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('repeated preparation retains explicit executables and one PATH entry without downloading', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-environment-overrides-'));
  try {
    await execute(process.execPath, [
      '--input-type=module',
      '-e',
      `
      import assert from 'node:assert/strict';
      import {dirname} from 'node:path';
      import {prepareEnvironment} from ${JSON.stringify(new URL('../tools/environment.mjs', import.meta.url).href)};
      const supplied = process.execPath;
      process.env.VISUAL_STORY_PYTHON=supplied;process.env.VISUAL_STORY_UV=supplied;
      const options={python:true,signal:new AbortController().signal,progress(){throw Error('No preparation needed')}};
      await prepareEnvironment(process.argv[1],options);await prepareEnvironment(process.argv[1],options);
      assert.equal(process.env.VISUAL_STORY_PYTHON,supplied);assert.equal(process.env.VISUAL_STORY_UV,supplied);
      assert.equal(process.env.PATH.split(':').filter(p=>p===dirname(supplied)).length,1);
    `,
      directory,
    ]);
    assert.deepEqual(await readdir(directory), []);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
