import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workflows } from '../plugin/workflows.mjs';
import { projectFiles } from '../plugin/project-files.mjs';

async function fixture(t, mutation = '') {
  const directory = await mkdtemp(join(tmpdir(), 'story-workflow-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const projectPath = join(directory, 'project'),
    data = join(directory, 'data');
  await mkdir(projectPath);
  const pkg = { name: 'workflow-scene', version: '1.0.0' };
  await writeFile(join(projectPath, 'package.json'), JSON.stringify(pkg));
  await writeFile(
    join(projectPath, 'package-lock.json'),
    JSON.stringify({
      ...pkg,
      lockfileVersion: 3,
      packages: { '': pkg },
    }),
  );
  await writeFile(
    join(projectPath, 'scene.json'),
    JSON.stringify({ generator: { runner: 'node', file: 'generate.mjs' } }),
  );
  await writeFile(join(projectPath, 'value.txt'), 'original');
  await writeFile(
    join(projectPath, 'generate.mjs'),
    `
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
${mutation}
await writeFile(join(process.env.VISUAL_STORY_OUTPUT, 'index.html'), '<main>' + await readFile('value.txt', 'utf8') + '</main>');
`,
  );
  const input = {
    data,
    projectPath,
    projectId: randomUUID(),
    title: 'Inputs',
    sourceRevision: (await projectFiles(projectPath)).revision,
  };
  const build = (args = {}) =>
    workflows.build(
      { ...input, ...args },
      {
        jobId: randomUUID(),
        signal: new AbortController().signal,
        progress() {},
      },
    );
  const html = async (result) =>
    JSON.parse(await readFile(join(data, 'builds', result.buildRevision + '.json'), 'utf8')).html;
  return { input, build, html };
}

test('a generator cannot publish a different input under the captured source revision', async (t) => {
  const { input, build } = await fixture(
    t,
    `await writeFile('value.txt', 'changed by generator');`,
  );
  await assert.rejects(build(), /changed its source inputs/);
  assert.deepEqual(
    await readdir(join(input.data, 'builds')).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    }),
    [],
  );
  assert.equal(await readFile(join(input.projectPath, 'value.txt'), 'utf8'), 'original');
  const jobId = randomUUID(),
    output = join(input.projectPath, 'artifacts', jobId);
  await mkdir(output, { recursive: true });
  const receipt = JSON.stringify({ files: ['story.html'] });
  await writeFile(join(output, 'delivery.json'), receipt);
  await writeFile(join(output, 'story.html'), 'accepted delivery');
  await assert.rejects(
    workflows.produce(
      { ...input, options: { formats: ['html'] } },
      {
        jobId,
        signal: new AbortController().signal,
        progress() {},
      },
    ),
    /Scene or package changed during delivery/,
  );
  assert.equal(await readFile(join(output, 'story.html'), 'utf8'), 'accepted delivery');
  assert.equal(await readFile(join(output, 'delivery.json'), 'utf8'), receipt);
  assert.deepEqual((await readdir(join(input.projectPath, 'artifacts'))).sort(), [jobId]);
});

test('retry reuses verified snapshots and rejects damaged inputs or a newer working revision', async (t) => {
  const { input, build, html } = await fixture(t);
  const first = await build(),
    resumeFrom = first.snapshot.split('/').at(-1);
  await writeFile(join(input.projectPath, 'value.txt'), 'new authored value');
  assert.match(await html(await build({ resumeFrom })), /<main>original<\/main>/);
  await writeFile(join(first.snapshot, 'value.txt'), 'damaged input');
  await assert.rejects(build({ resumeFrom }), /Project changed before preparation/);
  await writeFile(join(input.projectPath, 'value.txt'), 'original');
  const recovered = await build({ resumeFrom });
  assert.equal(recovered.sourceRevision, input.sourceRevision);
  assert.match(await html(recovered), /<main>original<\/main>/);
});
