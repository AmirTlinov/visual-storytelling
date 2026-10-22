import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { connectRuntime } from '../plugin/runtime/client.mjs';
import { writeJSON } from '../tools/storage.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test(
  'opening examples and project placeholders waits for collection before publishing builds and cards',
  { timeout: 15000 },
  async (t) => {
    const temporary = await mkdtemp(join(tmpdir(), 'story-cache-publication-'));
    const directory = join(temporary, 'release/plugin/dist'),
      data = join(temporary, 'data');
    let runtime, pid;
    t.after(async () => {
      runtime?.close();
      if (pid) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch (error) {
          if (error.code !== 'ESRCH') throw error;
        }
      }
      await rm(temporary, { recursive: true, force: true });
    });
    await mkdir(join(directory, 'examples'), { recursive: true });
    await mkdir(data);
    await mkdir(join(temporary, 'release/tools'));
    await cp(join(root, 'tools/uv.lock'), join(temporary, 'release/tools/uv.lock'));
    const projectPath = join(temporary, 'project');
    await mkdir(projectPath);
    await writeFile(join(projectPath, 'scene.js'), 'export const project = 1;');
    await writeFile(
      join(directory, 'worker.mjs'),
      `process.on('message', () => {
      process.send({type:'result', result:{}}, () => process.disconnect());
    });`,
    );
    await build({
      entryPoints: [join(root, 'plugin/runtime/kernel.mjs')],
      outfile: join(directory, 'kernel.mjs'),
      bundle: true,
      platform: 'node',
      target: 'node22',
      format: 'esm',
      plugins: [
        {
          name: 'hold-collection-after-card-leases',
          setup(builder) {
            builder.onLoad({ filter: /plugin\/cache\.mjs$/ }, async ({ path }) => {
              const source = await readFile(path, 'utf8');
              const entry = '  for (const id of snapshotLeases) {';
              assert.ok(source.includes(entry));
              return {
                loader: 'js',
                contents:
                  "import {writeFile as mark, access as exists} from 'node:fs/promises';\nimport {setTimeout as pause} from 'node:timers/promises';\n" +
                  source.replace(
                    entry,
                    `
            await mark(join(data, 'collector-ready'), 'ready');
            while (!(await exists(join(data, 'collector-release')).then(() => true, () => false))) await pause(5);
          ` + entry,
                  ),
              };
            });
          },
        },
      ],
    });
    await writeJSON(join(directory, 'catalog.json'), {
      fixture: { title: 'Fixture', source: 'scene.js', recommended: true },
    });
    await writeJSON(join(directory, 'examples/fixture.json'), {
      revision: 'example-build',
      title: 'Fixture',
      html: '<main>prepared example</main>',
    });
    await writeJSON(join(data, 'preferences.json'), { cacheLimitMB: 0 });
    const previous = process.env.VISUAL_STORY_DATA_DIR;
    process.env.VISUAL_STORY_DATA_DIR = data;
    try {
      runtime = await connectRuntime(directory).catch(async (cause) => {
        throw new Error(await readFile(join(data, 'runtime.log'), 'utf8'), { cause });
      });
    } finally {
      if (previous === undefined) delete process.env.VISUAL_STORY_DATA_DIR;
      else process.env.VISUAL_STORY_DATA_DIR = previous;
    }
    pid = (await runtime.call('hello')).pid;
    for (let count = 0; count < 200; count++) {
      if (
        await readFile(join(data, 'collector-ready')).then(
          () => true,
          () => false,
        )
      )
        break;
      await delay(5);
    }
    assert.equal(await readFile(join(data, 'collector-ready'), 'utf8'), 'ready');
    const opening = runtime.call('open', { example: 'fixture' });
    const openingProject = runtime.call('open', { path: projectPath });
    assert.equal(
      await Promise.race([
        Promise.race([opening, openingProject]).then(() => 'opened'),
        delay(100).then(() => 'blocked'),
      ]),
      'blocked',
    );
    assert.deepEqual(await runtime.call('list'), []);
    await writeFile(join(data, 'collector-release'), 'released');
    const opened = await opening;
    const project = await openingProject;
    assert.ok(project.buildRevision.startsWith('preparing-'));
    const placeholder = await runtime.call('attach', {
      sessionId: project.sessionId,
      renderer: 'placeholder-race',
    });
    assert.equal(placeholder.html, '');
    assert.equal(placeholder.buildRevision, project.buildRevision);
    const attached = await runtime.call('attach', {
      sessionId: opened.sessionId,
      renderer: 'cache-race',
    });
    assert.equal(attached.html, '<main>prepared example</main>');
    assert.equal(attached.buildRevision, 'example-build');
    await runtime.call('preferences', { patch: { cacheLimitMB: 0 } });
    await runtime.call('job', { jobId: project.jobs[0].id, waitMs: 1000 });
    let cache;
    for (let count = 0; count < 200; count++) {
      cache = (await runtime.call('hello')).cache;
      if (cache?.protectedBytes > 0) break;
      await delay(5);
    }
    assert.ok(cache.protectedBytes > 0);
    assert.equal(cache.disposableBytes, 0);
    assert.equal(cache.totalBytes, cache.protectedBytes);
    assert.equal(cache.limitBytes, 0);
    assert.ok(Number.isFinite(Date.parse(cache.collectedAt)));
    assert.equal(
      JSON.parse(await readFile(join(data, 'builds', project.buildRevision + '.json'), 'utf8'))
        .html,
      '',
    );
    const reopened = await runtime.call('open', { sessionId: opened.sessionId });
    assert.equal(reopened.buildRevision, 'example-build');
    assert.equal(
      JSON.parse(await readFile(join(data, 'builds/example-build.json'), 'utf8')).html,
      attached.html,
    );
  },
);
