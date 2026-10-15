import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  writeFile,
  rm,
  readdir,
  chmod,
  mkdir,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { installRelease } from '../plugin/install.mjs';
import { pluginHost } from './plugin/host.mjs';
import { finishFixtureJob } from './plugin/authoring-fixture.mjs';
import { voiceAdapter } from './support/voice-adapter.mjs';
async function unlock(directory) {
  await chmod(directory, 0o700);
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (entry.isDirectory()) await unlock(join(directory, entry.name));
}
test(
  'installed JobRunner recovers interrupted publication through story_retry without another provider request',
  { timeout: 180000 },
  async (t) => {
    const directory = await realpath(await mkdtemp(join(tmpdir(), 'installed-voice-recovery-')));
    const installed = await installRelease(resolve('.plugin-release'), {
      directory: join(directory, 'installation'),
      register: false,
    });
    const data = join(directory, 'data'),
      marker = join(directory, 'fault.json'),
      hook = join(directory, 'fault.mjs');
    await writeFile(
      hook,
      `import fs from 'node:fs/promises';import sync from 'node:fs';import{dirname,join}from'node:path';const rename=fs.rename;const root=${JSON.stringify(join(data, 'snapshots'))},marker=${JSON.stringify(marker)};fs.rename=async(from,to)=>{const result=await rename(from,to);if(dirname(dirname(to))===root&&to.endsWith('/audio.wav')&&!sync.existsSync(marker)){sync.writeFileSync(marker,JSON.stringify({pid:process.pid,output:to}));process.kill(process.pid,'SIGKILL');}return result;};`,
    );
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = [previous, '--import=' + pathToFileURL(hook).href]
      .filter(Boolean)
      .join(' ');
    let host;
    try {
      host = await pluginHost({
        dataDirectory: data,
        initialTarget: {},
        serverCommand: join(installed.release, 'runtime/node'),
        serverEntry: join(installed.release, 'plugin/dist/server.mjs'),
      });
      const call = async (name, args) => {
        const result = await host.client.callTool({ name, arguments: args });
        assert(!result.isError, JSON.stringify(result));
        return result.structuredContent;
      };
      const finish = async (r) =>
        r.job ? (await finishFixtureJob(host.client, r.job.id)).result : r;
      const created = await finish(
        await call('story_create', {
          title: 'Проверим группы',
          requestId: randomUUID(),
          path: join(directory, 'project'),
          document: {
            recipe: 'division',
            inputs: { count: 17, divisor: 4 },
            chapters: [
              {
                id: 'lesson',
                title: 'Проверим',
                beats: [
                  {
                    id: 'look',
                    say: 'Посмотрим на предметы.',
                    speech: { id: 'voice.lesson.look', when: { basis: 'presented', models: [] } },
                  },
                ],
              },
            ],
          },
        }),
      );
      const configured = await finish(
        await call('story_edit', {
          context: created.project.context,
          requestId: randomUUID(),
          changes: [{ path: 'voice/adapter.mjs', content: voiceAdapter }],
        }),
      );
      const voiced = await call('story_voice', {
        context: configured.project.context,
        requestId: randomUUID(),
        enabled: true,
        provider: 'api',
        adapter: 'voice/adapter.mjs',
        model: 'fixture',
        voice: 'chosen',
        language: 'ru-RU',
      });
      assert(voiced.job?.id, JSON.stringify(voiced));
      let failed;
      for (let n = 0; n < 20; n++) {
        failed = await call('story_inspect', { jobId: voiced.job.id, waitMs: 15000 });
        if (!['queued', 'running', 'cancelling'].includes(failed.status)) break;
      }
      assert.equal(failed.status, 'failed', JSON.stringify(failed));
      const fault = JSON.parse(await readFile(marker, 'utf8')),
        snapshot = join(data, 'snapshots', voiced.job.id),
        calls = await readFile(join(snapshot, '.voice-calls'), 'utf8');
      await rm(join(data, 'speech'), { recursive: true, force: true });
      const retry = await call('story_retry', { jobId: voiced.job.id, requestId: randomUUID() });
      const result = await finishFixtureJob(host.client, retry.id ?? retry.job?.id);
      assert.equal(result.status, 'succeeded', JSON.stringify(result));
      assert.equal(await readFile(join(snapshot, '.voice-calls'), 'utf8'), calls);
      await assert.rejects(readFile(join(result.result.snapshot, '.voice-calls')), {
        code: 'ENOENT',
      });
      assert.equal(result.result.narration.current, true);
      assert.deepEqual(result.result.narration.pending, []);
      const receipt = {
        plugin: JSON.parse(await readFile(join(installed.release, 'plugin.json'))).version,
        release: installed.digest,
        core: JSON.parse(await readFile(join(installed.release, 'dist/build-info.json'))),
        failed: { id: failed.id, status: failed.status, error: failed.error },
        fault,
        retry: {
          id: result.id,
          status: result.status,
          sourceRevision: result.result.sourceRevision,
          narration: result.result.narration,
        },
        providerCalls: calls.trim().split('\n').map(JSON.parse),
        newProviderCalls: 0,
      };
      t.diagnostic(JSON.stringify(receipt));
      if (process.env.VISUAL_STORY_ACCEPTANCE_DIR) {
        await mkdir(process.env.VISUAL_STORY_ACCEPTANCE_DIR, { recursive: true });
        await writeFile(
          join(process.env.VISUAL_STORY_ACCEPTANCE_DIR, 'recovery.json'),
          JSON.stringify(receipt, null, 2),
        );
      }
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
      await host?.close();
      await unlock(directory);
      await rm(directory, { recursive: true, force: true });
    }
  },
);
