import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ProjectStore } from '../plugin/projects.mjs';
import { projectFiles, snapshotProject, projectFile } from '../plugin/project-files.mjs';
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
