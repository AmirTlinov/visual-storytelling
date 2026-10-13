import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { ProjectStore } from '../plugin/projects.mjs';
import { JobRunner } from '../plugin/jobs.mjs';
import { SessionDirectory } from '../plugin/session-directory.mjs';
import { projectAuthoring } from '../plugin/runtime/project-authoring.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function fixture(t, generator = '') {
  const temporary = await mkdtemp(join(tmpdir(), 'prepared-authoring-'));
  const data = join(temporary, 'data'),
    path = join(temporary, 'project');
  await mkdir(path);
  const pkg = { name: 'prepared-authoring-fixture', version: '1.0.0' };
  await writeFile(join(path, 'package.json'), JSON.stringify(pkg));
  await writeFile(
    join(path, 'package-lock.json'),
    JSON.stringify({ ...pkg, lockfileVersion: 3, packages: { '': pkg } }),
  );
  await writeFile(join(path, 'index.html'), '<main>original</main>');
  await writeFile(join(path, 'value.txt'), 'original');
  await writeFile(
    join(path, 'scene.json'),
    JSON.stringify({ generator: { runner: 'node', file: 'generate.mjs' } }),
  );
  const marker = join(temporary, 'builds.log');
  await writeFile(
    join(path, 'generate.mjs'),
    `
import { readFile, writeFile, appendFile, access } from 'node:fs/promises';
import { join } from 'node:path';
const value = await readFile('value.txt', 'utf8');
await appendFile(${JSON.stringify(marker)}, value + '\\n');
${typeof generator === 'function' ? generator(temporary) : generator}
await writeFile(join(process.env.VISUAL_STORY_OUTPUT, 'index.html'), '<main>' + value + '</main>');
`,
  );
  const projects = new ProjectStore(data);
  const project = await projects.register(path);
  const sessions = new SessionDirectory();
  let owner,
    publicationFailures = 0;
  const jobs = new JobRunner(data, join(root, 'plugin/dist/worker.mjs'), (job, result) =>
    owner.acceptCandidate(job, result),
  );
  await jobs.start();
  owner = projectAuthoring({
    data,
    directory: join(root, 'plugin/dist'),
    projects,
    sessions,
    jobs,
    watched: {
      open() {
        if (publicationFailures-- > 0) throw Error('publication interrupted');
      },
    },
  });
  t.after(async () => {
    await jobs.close();
    await rm(temporary, { recursive: true, force: true });
  });
  const edit = async (value) => {
    const current = await projects.inspect(project.id);
    const args = {
      projectId: project.id,
      sourceRevision: current.sourceRevision,
      requestId: randomUUID(),
      changes: [{ path: 'value.txt', content: value }],
    };
    return { args, result: await owner.edit(args) };
  };
  const finish = async (id) => {
    for (let i = 0; i < 4; i++) {
      const job = await jobs.wait(id);
      if (!['queued', 'running', 'cancelling'].includes(job.status)) return job;
    }
    throw Error('candidate preparation deadline');
  };
  return {
    temporary,
    path,
    data,
    project,
    projects,
    jobs,
    owner,
    marker,
    edit,
    finish,
    failPublication() {
      publicationFailures = 1;
    },
    text: () => readFile(join(path, 'value.txt'), 'utf8'),
    builds: () => readFile(marker, 'utf8'),
  };
}

test(
  'failed source candidate preserves the accepted source, dependency pin and history',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      "if (value === 'broken') throw Error('candidate compilation failed');",
    );
    const before = await f.projects.inspect(f.project.id);
    const pin = await readFile(join(f.path, 'package.json'));
    const edit = await f.edit('broken');
    assert.equal(edit.result.project.sourceRevision, before.sourceRevision);
    assert.equal(await f.text(), 'original');
    const failed = await f.finish(edit.result.job.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /candidate compilation failed/);
    assert.equal(await f.text(), 'original');
    assert.deepEqual(await readFile(join(f.path, 'package.json')), pin);
    assert.equal((await f.projects.inspect(f.project.id)).sourceRevision, before.sourceRevision);
    await assert.rejects(readFile(join(f.path, '.vstory/history', edit.args.requestId + '.json')), {
      code: 'ENOENT',
    });
  },
);

test(
  'prepared source commits one undoable change; an old repeat remains historical after another edit',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const first = await f.edit('candidate');
    assert.equal(await f.text(), 'original');
    const accepted = await f.finish(first.result.job.id);
    assert.equal(accepted.status, 'succeeded', JSON.stringify(accepted));
    assert.equal(await f.text(), 'candidate');
    const second = await f.edit('later');
    assert.equal((await f.finish(second.result.job.id)).status, 'succeeded');
    const repeated = await f.owner.edit(first.args);
    assert.equal(repeated.project.sourceRevision, accepted.result.project.sourceRevision);
    assert.equal(await f.text(), 'later');
    await assert.rejects(
      f.owner.edit({ ...first.args, changes: [{ path: 'value.txt', content: 'wrong retry' }] }),
      /different edit/,
    );
    const current = await f.projects.inspect(f.project.id);
    const undo = await f.owner.edit({
      projectId: f.project.id,
      sourceRevision: current.sourceRevision,
      requestId: randomUUID(),
      undo: true,
    });
    assert.equal((await f.finish(undo.job.id)).status, 'succeeded');
    assert.equal(await f.text(), 'candidate');
  },
);

test(
  'a concurrent external author wins over a successfully built stale candidate',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(
      t,
      (temporary) => `
if (value === 'candidate') {
  await writeFile(${JSON.stringify(join(temporary, 'ready'))}, 'ready');
  while (!(await access(${JSON.stringify(join(temporary, 'continue'))}).then(() => true, () => false)))
    await new Promise(resolve => setTimeout(resolve, 20));
}`,
    );
    const editing = await f.edit('candidate');
    const deadline = Date.now() + 10000;
    while (
      !(await access(join(f.temporary, 'ready')).then(
        () => true,
        () => false,
      ))
    ) {
      assert(Date.now() < deadline, 'worker started its frozen candidate');
      await delay(20);
    }
    await writeFile(join(f.path, 'value.txt'), 'external author');
    await writeFile(join(f.temporary, 'continue'), 'continue');
    const failed = await f.finish(editing.result.job.id);
    assert.equal(failed.status, 'failed');
    assert.match(failed.error, /Source conflict/);
    assert.equal(await f.text(), 'external author');
  },
);

test(
  'a post-commit delivery failure retries only the verified artifact',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    f.failPublication();
    const editing = await f.edit('candidate');
    const accepted = await f.finish(editing.result.job.id);
    assert.equal(accepted.status, 'succeeded');
    assert.equal(accepted.result.delivery, 'failed');
    assert.equal(await f.text(), 'candidate');
    const before = await f.builds();
    const repeated = await f.owner.edit(editing.args);
    assert.equal(repeated.delivery, 'pending');
    assert.equal(await f.builds(), before, 'delivery retry does not rerun the generator');
    assert.equal(await f.text(), 'candidate');
  },
);

test('a mismatched prepared artifact is rejected before source publication', async (t) => {
  const f = await fixture(t);
  const current = await f.projects.inspect(f.project.id);
  const proposal = await f.projects.stageEdit({
    projectId: current.id,
    sourceRevision: current.sourceRevision,
    requestId: randomUUID(),
    changes: [{ path: 'value.txt', content: 'candidate' }],
  });
  await assert.rejects(
    f.owner.commitPrepared(proposal, {
      projectId: randomUUID(),
      revision: 'wrong-project',
      sourceRevision: 'candidate',
      snapshot: '/unused',
    }),
    /does not match/,
  );
  assert.equal(await f.text(), 'original');
});
