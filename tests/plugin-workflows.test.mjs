import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workflows } from '../plugin/workflows.mjs';
import { projectFiles } from '../plugin/project-files.mjs';
import { ProjectStore } from '../plugin/projects.mjs';
import { revisionInput } from '../plugin/revision-input.mjs';
import { collectCache } from '../plugin/cache.mjs';

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
    /changed its source inputs/,
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

test('explicit revision survives edits, queued cancellation, retry and cache collection; a built release is reused', async (t) => {
  const counterDirectory = await mkdtemp(join(tmpdir(), 'story-build-counter-'));
  const counter = join(counterDirectory, 'count');
  t.after(() => rm(counterDirectory, { recursive: true, force: true }));
  const { input } = await fixture(
    t,
    `
const counter = ${JSON.stringify(counter)};
await writeFile(counter, String(Number(await readFile(counter, 'utf8').catch(() => '0')) + 1));
`,
  );
  const projects = new ProjectStore(input.data);
  await projects.remember({ id: input.projectId, path: input.projectPath, title: input.title });
  const target = {
    kind: 'working',
    projectId: input.projectId,
    sourceRevision: input.sourceRevision,
  };
  const frozen = await revisionInput(input.data, projects, target);
  await writeFile(join(input.projectPath, 'value.txt'), 'later edit');
  const task = () => ({ jobId: randomUUID(), signal: new AbortController().signal, progress() {} });
  // A queued cancellation has no worker snapshot yet. Retry still uses the selected input.
  const first = await workflows.produce(
    { data: input.data, ...frozen, resumeFrom: randomUUID(), options: { formats: ['html'] } },
    task(),
  );
  assert.match(await readFile(first.files[0], 'utf8'), /<main>original<\/main>/);
  assert.equal(first.sourceRevision, target.sourceRevision);
  assert.equal(await readFile(counter, 'utf8'), '1');
  const built = await revisionInput(input.data, projects, {
    kind: 'build',
    projectId: input.projectId,
    buildRevision: first.buildRevision,
  });
  await collectCache(input.data, {
    limitMB: 0,
    projects: [],
    sessions: [],
    snapshotLeases: [built.inputSnapshot],
  });
  const checkpoint = { time: 3, progress: 0.3, mode: 'explore', values: { x: 4 } };
  const second = await workflows.produce(
    { data: input.data, ...built, checkpoint, options: { formats: ['html'] } },
    task(),
  );
  assert.equal(second.buildRevision, first.buildRevision);
  assert.equal(
    await readFile(counter, 'utf8'),
    '1',
    'ready output is reused without a generator or narration pass',
  );
  const receipt = JSON.parse(await readFile(join(second.directory, 'delivery.json'), 'utf8'));
  assert.deepEqual(receipt.checkpoint, checkpoint);
  assert.equal(receipt.sourceRevision, target.sourceRevision);
  assert.match(await readFile(second.files[0], 'utf8'), /scene.restore/);
  await assert.rejects(
    revisionInput(input.data, projects, target),
    (error) => error.code === 'source_conflict',
  );
  await writeFile(
    join(input.data, 'snapshots', built.inputSnapshot, 'dist/index.html'),
    '<main>tampered</main>',
  );
  await assert.rejects(
    workflows.produce({ data: input.data, ...built, options: { formats: ['html'] } }, task()),
    /prepared build is unavailable or changed/,
  );
});
