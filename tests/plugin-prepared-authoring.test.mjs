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
import { revisionInput } from '../plugin/revision-input.mjs';
import { collectCache } from '../plugin/cache.mjs';

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
  let projects = new ProjectStore(data);
  const project = await projects.register(path);
  const sessions = new SessionDirectory();
  let owner,
    publicationFailures = 0;
  const runner = () => new JobRunner(data, join(root, 'plugin/dist/worker.mjs'), (job, result) =>
    result.creation ? owner.acceptCreationJob(job, result)
      : result.migration ? owner.acceptMigration(job, result)
        : job.input.authoring ? owner.acceptCandidate(job, result) : result);
  let jobs = runner();
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
    async restart() {
      await jobs.close();
      projects = new ProjectStore(data);
      await projects.start();
      jobs = runner();
      await jobs.start();
      owner = projectAuthoring({ data, directory: join(root, 'plugin/dist'), projects, sessions,
        jobs, watched: { open() {} } });
      return { projects, jobs, owner };
    },
    text: () => readFile(join(path, 'value.txt'), 'utf8'),
    builds: () => readFile(marker, 'utf8'),
  };
}

test('an ordinary working rebuild cannot supersede an authored candidate', { timeout: 30000 }, async (t) => {
  const f = await fixture(t, (temporary) => `
if (value === 'candidate') {
  await writeFile(${JSON.stringify(join(temporary, 'ready'))}, 'ready');
  while (!(await access(${JSON.stringify(join(temporary, 'continue'))}).then(() => true, () => false)))
    await new Promise(resolve => setTimeout(resolve, 10));
}`);
  const authored = await f.edit('candidate');
  while (!(await access(join(f.temporary, 'ready')).then(() => true, () => false))) await delay(10);
  const working = await revisionInput(f.data, f.projects, { kind: 'working', projectId: f.project.id,
    sourceRevision: f.project.sourceRevision });
  const rebuild = await f.jobs.enqueue('build', { data: f.data, ...working }, randomUUID());
  assert.equal(f.jobs.get(authored.result.job.id).status, 'running');
  assert.equal(f.jobs.get(authored.result.job.id).supersededBy, undefined);
  await writeFile(join(f.temporary, 'continue'), 'continue');
  assert.equal((await f.finish(authored.result.job.id)).status, 'succeeded');
  assert.equal((await f.finish(rebuild.id)).status, 'succeeded');
  assert.equal(await f.text(), 'candidate');
});

test('restart resumes an accepted source transaction whose job lost its result after commit', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const commit = f.projects.commitPreparedEdit.bind(f.projects);
  f.projects.commitPreparedEdit = async (proposal) => {
    await commit(proposal);
    throw Error('process interrupted after the durable source commit');
  };
  const authored = await f.edit('candidate');
  const interrupted = await f.finish(authored.result.job.id);
  assert.equal(interrupted.status, 'failed');
  assert.equal(interrupted.result, undefined);
  assert.equal(await f.text(), 'candidate');
  const receipt = await f.projects.editDelivery(f.project.id, authored.args.requestId);
  assert.ok(receipt.buildRevision);
  assert.equal(receipt.project.sourceRevision, receipt.sourceRevision);
  const restarted = await f.restart();
  const resumed = await restarted.owner.edit(authored.args);
  assert.equal(resumed.job.status, 'succeeded');
  assert.equal(resumed.project.sourceRevision, receipt.sourceRevision);
  assert.equal(resumed.job.result.buildRevision, receipt.buildRevision);
  assert.equal(await f.builds(), 'candidate\n', 'the accepted artifact is published without a second build');
  const undo = await restarted.owner.edit({ projectId: f.project.id, sourceRevision: resumed.project.sourceRevision,
    requestId: randomUUID(), undo: true });
  assert.equal((await f.finish(undo.job.id)).status, 'succeeded');
  assert.equal(await f.text(), 'original');
});

test('an unfinished source journal protects its prepared frame from cache eviction across restart', { timeout: 30000 }, async (t) => {
  const f = await fixture(t);
  const update = f.projects.update.bind(f.projects);
  f.projects.update = async (id, patch) => {
    if (patch.buildRevision) throw Error('registry unavailable after source publication');
    return update(id, patch);
  };
  const authored = await f.edit('candidate');
  assert.equal((await f.finish(authored.result.job.id)).status, 'failed');
  assert.equal(await f.text(), 'candidate');
  const leases = await f.projects.preparedBuildLeases();
  assert.equal(leases.length, 1);
  await collectCache(f.data, { limitMB: 0, projects: await f.projects.list(), sessions: [],
    snapshotLeases: [], buildLeases: leases });
  await access(join(f.data, 'builds', leases[0] + '.json'));
  const restarted = await f.restart();
  const resumed = await restarted.owner.edit(authored.args);
  assert.equal(resumed.job.status, 'succeeded');
  assert.equal(resumed.job.result.buildRevision, leases[0]);
  assert.equal(await f.builds(), 'candidate\n');
  assert.deepEqual(await restarted.projects.preparedBuildLeases(), []);
});

test('source creation and migration resume accepted journals after losing the worker result', { timeout: 60000 }, async (t) => {
  const f = await fixture(t);
  const commit = f.projects.commitPreparedEdit.bind(f.projects);
  let interrupt = true;
  f.projects.commitPreparedEdit = async (proposal) => {
    const result = await commit(proposal);
    if (interrupt) { interrupt = false; throw Error('publication interrupted after commit'); }
    return result;
  };
  const input = { title: 'Recover source creation', path: join(f.temporary, 'created'), requestId: randomUUID() };
  const created = await f.owner.create(input);
  assert.equal(created.authoring, 'ready');
  assert.equal(created.job.status, 'succeeded');
  assert.equal(created.job.result.project.id, created.project.id);
  assert.equal((await f.owner.create(input)).job.id, created.job.id);
  assert.equal(f.jobs.list(created.project.id).length, 1, 'creation resumes its single preparation');
  interrupt = true;
  const migrationInput = { projectId: created.project.id, sourceRevision: created.project.sourceRevision, requestId: randomUUID() };
  const migrating = await f.owner.migrate(migrationInput);
  const failed = await f.finish(migrating.id);
  assert.equal(failed.status, 'failed');
  const durable = await f.projects.editDelivery(created.project.id, migrating.id + '-migration');
  assert.ok(durable.buildRevision);
  const recovered = await f.owner.migrate(migrationInput);
  assert.equal(recovered.status, 'succeeded');
  assert.equal(recovered.result.buildRevision, durable.buildRevision);
  assert.equal(f.jobs.list(created.project.id).length, 2, 'migration resumes without a second preparation');
});

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
