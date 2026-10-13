import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProjectStore } from '../plugin/projects.mjs';
import { projectFiles, snapshotProject, projectFile } from '../tools/project-files.mjs';
import { pinSceneProject } from '../tools/scene-project.mjs';
import { writeBuildInfo } from '../tools/build-info.mjs';

const run = promisify(execFile);
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'story-projects-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'project');
  await mkdir(root);
  await writeFile(join(root, 'a.js'), 'a0');
  await writeFile(join(root, 'b.js'), 'b0');
  const store = new ProjectStore(join(directory, 'data'));
  const project = await store.register(root);
  const edit = async (changes, undo = false) => {
    const current = await store.inspect(project.id);
    const args = {
      projectId: project.id,
      sourceRevision: current.sourceRevision,
      requestId: randomUUID(),
      changes,
      undo,
    };
    return { args, result: await store.edit(args) };
  };
  return {
    directory,
    root,
    store,
    project,
    edit,
    text: (name = 'a.js') => readFile(join(root, name), 'utf8'),
  };
}

test('a failed registry write never publishes a successful receipt in memory; retry survives restart', async (t) => {
  const f = await fixture(t);
  const file = join(f.directory, 'data/projects.json');
  const original = await readFile(file);
  const before = structuredClone(f.store.get(f.project.id));
  const next = {
    ...before,
    creation: { requestId: 'creation-retry', receipt: { accepted: true } },
  };
  await rm(file);
  await mkdir(file);
  await assert.rejects(f.store.remember(next));
  assert.deepEqual(f.store.get(f.project.id), before);
  await rm(file, { recursive: true });
  await writeFile(file, original);
  await f.store.remember(next);
  const reopened = new ProjectStore(join(f.directory, 'data'));
  await reopened.start();
  assert.deepEqual(reopened.get(f.project.id), JSON.parse(JSON.stringify(next)));
});

test('creation reserves its request before files and resumes only its own manifest after restart', async (t) => {
  for (const explicit of [false, true])
    await t.test(explicit ? 'explicit path' : 'implicit path', async (t) => {
      const directory = await mkdtemp(join(tmpdir(), 'story-reservation-'));
      t.after(() => rm(directory, { recursive: true, force: true }));
      const data = join(directory, 'data');
      const path = join(directory, 'project');
      const store = new ProjectStore(data);
      const input = {
        title: 'Reserved',
        document: { model: { kind: 'division', count: 13, divisor: 3 } },
        ...(explicit ? { path } : {}),
      };
      const options = { title: input.title, creation: { requestId: randomUUID(), input } };
      const gate = Promise.withResolvers();
      const queued = Promise.withResolvers();
      store.registrySave = gate.promise;
      const remember = store.remember.bind(store);
      store.remember = (record) => {
        queued.resolve(record);
        return remember(record);
      };
      // Stop at the first materialization boundary, after the real registry commit.
      store.registerPath = async () => {
        throw new Error('interrupted before manifest');
      };
      const creating = store.create(path, options);
      const rejected = assert.rejects(creating, /interrupted before manifest/);
      const reservation = await queued.promise;
      await assert.rejects(access(path), { code: 'ENOENT' });
      assert.equal(store.projects.size, 0);
      gate.resolve();
      await rejected;
      const reopened = new ProjectStore(data);
      await reopened.start();
      assert.equal(reopened.creation(options.creation.requestId).id, reservation.id);
      assert.deepEqual(reopened.creation(options.creation.requestId).creation.input, {
        ...input,
        ...(explicit ? { path: reservation.path } : {}),
      });
      await assert.rejects(
        reopened.create(path, {
          ...options,
          creation: { ...options.creation, requestId: randomUUID() },
        }),
        /another project/,
      );
      await assert.rejects(
        reopened.create(path, {
          ...options,
          creation: { ...options.creation, input: { ...input, title: 'Changed' } },
        }),
        /requestId/,
      );
      const foreign = JSON.stringify({ format: 1, id: randomUUID(), title: 'Other project' });
      await writeFile(join(path, 'story.vstory'), foreign);
      await assert.rejects(reopened.create(path, options), /another story/);
      assert.equal(await readFile(join(path, 'story.vstory'), 'utf8'), foreign);
      await rm(join(path, 'story.vstory'));
      await writeFile(join(path, 'foreign.js'), 'preserve me');
      await assert.rejects(reopened.create(path, options), /empty directory/);
      await assert.rejects(reopened.register(path), /changed before its manifest/);
      assert.equal(await readFile(join(path, 'foreign.js'), 'utf8'), 'preserve me');
      await rm(join(path, 'foreign.js'));
      const recovered = await reopened.create(path, options);
      assert.equal(recovered.id, reservation.id);
      assert.equal(recovered.path, reservation.path);
      assert.equal(
        JSON.parse(await readFile(join(path, 'story.vstory'), 'utf8')).id,
        reservation.id,
      );
      assert.equal((await reopened.register(path)).id, reservation.id);
      assert.equal(reopened.projects.size, 1);
    });
});

test('a failed first creation commit leaves no candidate directory or unbound project', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-reservation-failed-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const data = join(directory, 'data');
  const file = join(data, 'projects.json');
  await mkdir(file, { recursive: true });
  const store = new ProjectStore(data);
  const path = join(directory, 'implicit-candidate');
  const options = {
    title: 'Reserved',
    creation: { requestId: randomUUID(), input: { title: 'Reserved', document: { model: {} } } },
  };
  await assert.rejects(store.create(path, options));
  assert.equal(store.projects.size, 0);
  await assert.rejects(access(path), { code: 'ENOENT' });
  await rm(file, { recursive: true });
  const reopened = new ProjectStore(data);
  await reopened.start();
  const project = await reopened.create(path, options);
  assert.equal(reopened.creation(options.creation.requestId).id, project.id);
  assert.equal(reopened.projects.size, 1);
});

test('authoring undo walks applied edits across restart and a new branch; request receipts never become undo entries', async (t) => {
  const f = await fixture(t);
  await f.edit([{ path: 'a.js', content: 'a1' }]);
  await f.edit([{ path: 'a.js', content: 'a2' }]);
  const third = await f.edit([{ path: 'a.js', content: 'a3' }]);
  const undo = await f.edit(undefined, true);
  assert.equal(await f.text(), 'a2');
  await f.store.edit(undo.args);
  assert.equal(await f.text(), 'a2');
  const reopened = new ProjectStore(join(f.directory, 'data'));
  await reopened.start();
  const apply = async (changes, undo = false) =>
    reopened.edit({
      projectId: f.project.id,
      sourceRevision: (await reopened.inspect(f.project.id)).sourceRevision,
      requestId: randomUUID(),
      changes,
      undo,
    });
  await apply(undefined, true);
  assert.equal(await f.text(), 'a1');
  await apply([{ path: 'a.js', content: 'branch' }]);
  await apply([{ path: 'a.js', content: 'branch' }]);
  await apply(undefined, true);
  assert.equal(await f.text(), 'a1');
  await apply(undefined, true);
  assert.equal(await f.text(), 'a0');
  await assert.rejects(apply(undefined, true), /No authored edit/);
  assert.equal((await reopened.edit(third.args)).repeated, true);
  assert.equal(await f.text(), 'a0');
  await assert.rejects(
    reopened.edit({ ...third.args, changes: [{ path: 'a.js', content: 'reused id' }] }),
    /requestId/,
  );
});

test('recovery detects external writes between files and after the series, keeps the journal, and resumes once resolved', async (t) => {
  for (const boundary of ['before-second', 'after-series']) {
    await t.test(boundary, async (t) => {
      const f = await fixture(t),
        original = f.store.write.bind(f.store);
      let injected = false;
      f.store.write = async (root, entry) => {
        if (boundary === 'before-second' && entry.path === 'b.js' && !injected) {
          injected = true;
          await writeFile(join(root, 'b.js'), 'external');
        }
        await original(root, entry);
        if (boundary === 'after-series' && entry.path === 'b.js' && !injected) {
          injected = true;
          await writeFile(join(root, 'a.js'), 'external');
        }
      };
      await assert.rejects(
        f.edit([
          { path: 'a.js', content: 'a1' },
          { path: 'b.js', content: 'b1' },
        ]),
        /Interrupted edit conflicts/,
      );
      const name = boundary === 'before-second' ? 'b.js' : 'a.js';
      assert.equal(await f.text(name), 'external');
      await access(join(f.root, '.vstory/transaction.json'));
      await assert.rejects(f.store.recover(f.project), /Interrupted edit conflicts/);
      assert.equal(await f.text(name), 'external');
      await writeFile(join(f.root, name), boundary === 'before-second' ? 'b0' : 'a1');
      f.store.write = original;
      await f.store.recover(f.project);
      assert.equal(await f.text(), 'a1');
      assert.equal(await f.text('b.js'), 'b1');
      await f.edit(undefined, true);
      assert.equal(await f.text(), 'a0');
      assert.equal(await f.text('b.js'), 'b0');
    });
  }
});

test('create preserves existing documents; registration shares identity and edits reject a revision changed during preparation', async (t) => {
  const f = await fixture(t);
  const manifest = await readFile(join(f.root, 'story.vstory'));
  await assert.rejects(f.store.create(f.root, { title: 'Overwrite' }), /empty directory/);
  assert.deepEqual(await readFile(join(f.root, 'story.vstory')), manifest);
  await f.store.remember({ ...f.store.get(f.project.id), buildRevision: 'ready-build' });
  const registrations = await Promise.all([f.store.register(f.root), f.store.register(f.root)]);
  assert.ok(registrations.every((p) => p.id === f.project.id && p.buildRevision === 'ready-build'));
  const state = await f.store.inspect(f.project.id),
    original = f.store.inspect.bind(f.store);
  f.store.inspect = async (id) => {
    const result = await original(id);
    await writeFile(join(f.root, 'a.js'), 'external');
    return result;
  };
  await assert.rejects(
    f.store.edit({
      projectId: f.project.id,
      sourceRevision: state.sourceRevision,
      requestId: randomUUID(),
      changes: [{ path: 'a.js', content: 'agent' }],
    }),
    /Source changed/,
  );
  assert.equal(await f.text(), 'external');
});

test('snapshots own only fresh external directories; internal links can be read without becoming ambiguous edit targets', async (t) => {
  const f = await fixture(t),
    target = join(f.directory, 'snapshot');
  await mkdir(target);
  await writeFile(join(target, 'keep.txt'), 'valuable');
  await assert.rejects(snapshotProject(f.root, target), { code: 'EEXIST' });
  assert.equal(await readFile(join(target, 'keep.txt'), 'utf8'), 'valuable');
  await assert.rejects(snapshotProject(f.root, join(f.root, 'artifacts', 'snapshot')), /outside/);
  await symlink('a.js', join(f.root, 'linked.js'));
  await assert.rejects(
    projectFile(f.root, 'linked.js', { writable: true }),
    /original project file/,
  );
  const source = await projectFiles(f.root),
    copied = join(f.directory, 'fresh');
  assert.deepEqual(await snapshotProject(f.root, copied, source.revision), source);
  assert.equal(await readFile(join(copied, 'linked.js'), 'utf8'), 'a0');
});

test('a new scene ships an immutable runtime archive and its lockfile before preparation', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-pinning-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const library = join(directory, 'library'),
    scene = join(directory, 'scene');
  await mkdir(join(library, 'dist'), { recursive: true });
  await mkdir(scene);
  await writeFile(
    join(library, 'package.json'),
    JSON.stringify({
      name: '@visual-storytelling/core',
      version: '0.0.1',
      type: 'module',
      files: ['dist'],
      exports: './dist/index.js',
    }),
  );
  await writeFile(join(library, 'dist/index.js'), 'export const value = 7;\n');
  await writeFile(
    join(library, 'dist/api.json'),
    JSON.stringify({ modules: { '.': { value: 'index.d.ts' } } }),
  );
  await writeBuildInfo(library, join(library, 'dist'));
  const receipt = await pinSceneProject(scene, { root: library, build: false });
  const lock = JSON.parse(await readFile(join(scene, 'package-lock.json'), 'utf8'));
  assert.equal(lock.packages[''].dependencies['@visual-storytelling/core'], receipt.dependency);
  assert.match(lock.packages['node_modules/@visual-storytelling/core'].integrity, /^sha512-/);
  await run('npm', ['ci', '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: scene,
  });
  assert.equal(
    await readFile(join(scene, 'node_modules/@visual-storytelling/core/dist/index.js'), 'utf8'),
    'export const value = 7;\n',
  );
});

test('a staged edit resolves once, commits the validated proposal and repeats its durable receipt', async (t) => {
  const f = await fixture(t);
  const resolve = f.store.resolveEdit.bind(f.store);
  let resolutions = 0;
  f.store.resolveEdit = (...args) => {
    resolutions++;
    return resolve(...args);
  };
  const args = {
    projectId: f.project.id,
    sourceRevision: f.project.sourceRevision,
    requestId: randomUUID(),
    changes: [{ path: 'a.js', content: 'validated' }],
  };
  const prepared = await f.store.stageEdit(args);
  assert.equal(await f.text(), 'a0', 'staging leaves source intact');
  args.changes[0].content = 'changed after validation';
  const committed = await f.store.commitPreparedEdit(prepared);
  assert.equal(await f.text(), 'validated');
  assert.equal(resolutions, 1);
  const repeated = await f.store.edit(prepared.args);
  assert.equal(repeated.repeated, true);
  assert.equal(repeated.sourceRevision, committed.sourceRevision);
  assert.equal(resolutions, 1, 'a receipt does not prepare a new candidate');
});

test('staged edits fence source changes and history changes even when source returns to the same bytes', async (t) => {
  for (const boundary of ['source', 'history'])
    await t.test(boundary, async (t) => {
      const f = await fixture(t);
      const prepared = await f.store.stageEdit({
        projectId: f.project.id,
        sourceRevision: f.project.sourceRevision,
        requestId: randomUUID(),
        changes: [{ path: 'a.js', content: 'candidate' }],
      });
      if (boundary === 'source') await writeFile(join(f.root, 'b.js'), 'external');
      else {
        await f.edit([{ path: 'b.js', content: 'branch' }]);
        await f.edit([{ path: 'b.js', content: 'b0' }]);
        assert.equal(
          (await f.store.inspect(f.project.id)).sourceRevision,
          f.project.sourceRevision,
        );
      }
      await assert.rejects(
        f.store.commitPreparedEdit(prepared),
        (error) => error.code === (boundary === 'source' ? 'source_conflict' : 'history_conflict'),
      );
      assert.equal(await f.text(), 'a0');
      await assert.rejects(access(join(f.root, '.vstory/transaction.json')), { code: 'ENOENT' });
    });
});

test('project identity fences staged edits and interrupted publication across restart', async (t) => {
  const f = await fixture(t);
  const manifestFile = join(f.root, 'story.vstory');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const other = { ...manifest, id: randomUUID() };
  const args = {
    projectId: f.project.id,
    sourceRevision: f.project.sourceRevision,
    requestId: randomUUID(),
    changes: [{ path: 'a.js', content: 'accepted candidate' }],
  };
  const prepared = await f.store.stageEdit(args);
  await writeFile(manifestFile, JSON.stringify(other));
  await assert.rejects(f.store.commitPreparedEdit(prepared), { code: 'project_conflict' });
  assert.equal(await f.text(), 'a0');
  await assert.rejects(access(join(f.root, '.vstory/transaction.json')), { code: 'ENOENT' });
  await writeFile(manifestFile, JSON.stringify(manifest));
  f.store.write = async () => { throw new Error('crash before source publication'); };
  await assert.rejects(f.store.commitPreparedEdit(prepared), /crash before/);
  await writeFile(manifestFile, JSON.stringify(other));
  const reopened = new ProjectStore(join(f.directory, 'data'));
  await reopened.start();
  await assert.rejects(reopened.recover(f.project), { code: 'project_conflict' });
  await assert.rejects(reopened.recover({ ...f.project, id: other.id }), { code: 'project_conflict' });
  assert.equal(await f.text(), 'a0');
  await access(join(f.root, '.vstory/transaction.json'));
  await writeFile(manifestFile, JSON.stringify(manifest));
  await reopened.recover(f.project);
  assert.equal(await f.text(), 'accepted candidate');
  assert.equal((await reopened.edit(args)).repeated, true);
});

async function assetFixture(t) {
  const f = await fixture(t);
  const source = join(f.directory, 'new-runtime.tgz');
  const bytes = Buffer.from('immutable runtime archive fixture');
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(source, bytes);
  const asset = { source, hash, path: `dependencies/visual-storytelling-core-${hash}.tgz` };
  const args = {
    projectId: f.project.id,
    sourceRevision: f.project.sourceRevision,
    requestId: randomUUID(),
    changes: [{ path: 'a.js', content: 'new runtime pin' }],
    assets: [asset],
  };
  return { ...f, asset, args, bytes };
}

test('migration staging and a failed journal leave the authored pin and source revision intact', async (t) => {
  const f = await assetFixture(t);
  const prepared = await f.store.stageEdit(f.args);
  await assert.rejects(access(join(f.root, f.asset.path)), { code: 'ENOENT' });
  // Fail journal publication after private asset capture, before any authored file transition.
  const assetDirectory = f.store.assetDirectory.bind(f.store);
  f.store.assetDirectory = async (project) => {
    const directory = await assetDirectory(project);
    await mkdir(join(f.root, '.vstory/transaction.json'));
    return directory;
  };
  await assert.rejects(f.store.commitPreparedEdit(prepared));
  assert.equal(await f.text(), 'a0');
  assert.equal((await f.store.inspect(f.project.id)).sourceRevision, f.project.sourceRevision);
  await assert.rejects(access(join(f.root, f.asset.path)), { code: 'ENOENT' });
  await rm(join(f.root, '.vstory/transaction.json'), { recursive: true });
  f.store.assetDirectory = assetDirectory;
  await f.store.commitPreparedEdit(prepared);
  assert.equal(await f.text(), 'new runtime pin');
  assert.deepEqual(await readFile(join(f.root, f.asset.path)), f.bytes);
});

test('a migration journal recovers assets and source after restart without the worker candidate', async (t) => {
  for (const boundary of ['before-asset', 'after-asset'])
    await t.test(boundary, async (t) => {
      const f = await assetFixture(t);
      const publish = f.store.publishAsset.bind(f.store);
      f.store.publishAsset = async (...args) => {
        if (boundary === 'after-asset') await publish(...args);
        throw new Error('interrupted asset publication');
      };
      await assert.rejects(f.store.edit(f.args), /interrupted asset publication/);
      assert.equal(await f.text(), 'a0');
      await access(join(f.root, '.vstory/transaction.json'));
      await rm(f.asset.source);
      const reopened = new ProjectStore(join(f.directory, 'data'));
      await reopened.start();
      const recovered = await reopened.edit(f.args);
      assert.equal(recovered.repeated, true);
      assert.equal(await f.text(), 'new runtime pin');
      assert.deepEqual(await readFile(join(f.root, f.asset.path)), f.bytes);
      await reopened.edit({
        projectId: f.project.id,
        sourceRevision: recovered.sourceRevision,
        requestId: randomUUID(),
        undo: true,
      });
      assert.equal(await f.text(), 'a0');
      assert.deepEqual(
        await readFile(join(f.root, f.asset.path)),
        f.bytes,
        'undo retains immutable packages',
      );
    });
});
