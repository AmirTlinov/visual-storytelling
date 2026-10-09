import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBuildInfo } from '../tools/build-info.mjs';
import { pinSceneProject } from '../tools/scene-project.mjs';
import { ProjectStore } from '../plugin/projects.mjs';
import { JobRunner } from '../plugin/jobs.mjs';
import { workflows } from '../plugin/workflows.mjs';

// Uses the current built package, because the failure is an actual removed public export.
test(
  'a breaking runtime migration delivers complete sources through its worker, rejects a revision race and undoes both',
  { timeout: 90000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'story-migration-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const library = join(directory, 'old-runtime'),
      projectPath = join(directory, 'project'),
      data = join(directory, 'data');
    await mkdir(join(library, 'dist'), { recursive: true });
    await mkdir(projectPath);
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
    await writeFile(
      join(library, 'dist/index.js'),
      'export const explanationLayout = () => "old-layout";\n',
    );
    await writeFile(
      join(library, 'dist/api.json'),
      JSON.stringify({ modules: { '.': { explanationLayout: 'index.d.ts' } } }),
    );
    await writeBuildInfo(library, join(library, 'dist'));
    const pinned = await pinSceneProject(projectPath, { root: library, build: false });
    await writeFile(
      join(projectPath, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"></head><body><main></main><script type="module" src="scene.js"></script></body></html>',
    );
    const oldSource =
      'import { explanationLayout } from "@visual-storytelling/core"; document.querySelector("main").textContent = explanationLayout();\n';
    const newSource =
      'import { lettering } from "@visual-storytelling/core"; document.querySelector("main").textContent = typeof lettering;\n' +
      '// ' +
      'Detailed authored lesson. '.repeat(3000) +
      '\n';
    await writeFile(join(projectPath, 'scene.js'), oldSource);
    await writeFile(join(projectPath, 'obsolete.js'), 'Old presentation entry\n');
    const projects = new ProjectStore(data),
      project = await projects.register(projectPath);
    const original = await Promise.all(
      ['scene.js', 'package.json', 'package-lock.json'].map((path) =>
        readFile(join(projectPath, path)),
      ),
    );
    const oldArchive = pinned.dependency.replace(/^file:(?:\.\/)?/, '');
    const oldBytes = await readFile(join(projectPath, oldArchive));
    const task = () => ({
      jobId: randomUUID(),
      signal: new AbortController().signal,
      progress() {},
    });
    const input = {
      data,
      projectId: project.id,
      projectPath,
      sourceRevision: project.sourceRevision,
    };

    // Candidate preparation shares edit boundaries before touching packages or source files.
    for (const change of [
      { path: '../outside.js', content: 'outside' },
      { path: '.vstory/transaction.json', content: '{}' },
      { path: oldArchive, content: null },
    ])
      await assert.rejects(
        workflows.migrate({ ...input, changes: [change] }, task()),
        /Invalid authored file|binary or large source files/,
      );
    await symlink('scene.js', join(projectPath, 'linked.js'));
    await assert.rejects(
      workflows.migrate({ ...input, changes: [{ path: 'linked.js', content: newSource }] }, task()),
      /instead of its link/,
    );
    await rm(join(projectPath, 'linked.js'));

    await assert.rejects(workflows.migrate(input, task()), /No matching export.*explanationLayout/);
    assert.equal((await projects.inspect(project.id)).sourceRevision, project.sourceRevision);
    const runner = new JobRunner(
      data,
      fileURLToPath(new URL('../plugin/runtime/worker.mjs', import.meta.url)),
    );
    await runner.start();
    t.after(() => runner.close());
    let migration = await runner.enqueue(
      'migrate',
      {
        ...input,
        changes: [
          { path: 'scene.js', content: newSource },
          { path: 'obsolete.js', content: null },
        ],
      },
      randomUUID(),
    );
    while (['queued', 'running', 'cancelling'].includes(migration.status))
      migration = await runner.wait(migration.id);
    assert.equal(migration.status, 'succeeded', migration.error);
    const { result } = migration;
    assert.ok(
      Buffer.byteLength(JSON.stringify(result)) > 65536,
      'the real migration result exceeds one IPC write',
    );
    assert.equal(
      (await projects.inspect(project.id)).sourceRevision,
      project.sourceRevision,
      'successful candidate leaves working files untouched until publication',
    );
    assert.deepEqual(
      new Set(result.migration.changes.map((change) => change.path)),
      new Set(['scene.js', 'obsolete.js', 'package.json', 'package-lock.json']),
    );

    // A later user edit cannot be overwritten by the completion of a migration job.
    await writeFile(join(projectPath, 'scene.js'), 'user-edited-during-preparation');
    await assert.rejects(
      projects.edit({
        projectId: project.id,
        sourceRevision: project.sourceRevision,
        requestId: randomUUID(),
        ...result.migration,
      }),
      (error) => error.code === 'source_conflict',
    );
    assert.equal(
      await readFile(join(projectPath, 'scene.js'), 'utf8'),
      'user-edited-during-preparation',
    );
    assert.deepEqual(await readFile(join(projectPath, 'package.json')), original[1]);
    await writeFile(join(projectPath, 'scene.js'), oldSource);

    const published = await projects.edit({
      projectId: project.id,
      sourceRevision: project.sourceRevision,
      requestId: randomUUID(),
      ...result.migration,
    });
    assert.equal(await readFile(join(projectPath, 'scene.js'), 'utf8'), newSource);
    await assert.rejects(access(join(projectPath, 'obsolete.js')), { code: 'ENOENT' });
    assert.notDeepEqual(await readFile(join(projectPath, 'package.json')), original[1]);
    assert.deepEqual(await readFile(join(projectPath, oldArchive)), oldBytes);

    await projects.edit({
      projectId: project.id,
      sourceRevision: published.sourceRevision,
      requestId: randomUUID(),
      undo: true,
    });
    for (const [index, path] of ['scene.js', 'package.json', 'package-lock.json'].entries())
      assert.deepEqual(await readFile(join(projectPath, path)), original[index]);
    assert.equal(
      await readFile(join(projectPath, 'obsolete.js'), 'utf8'),
      'Old presentation entry\n',
    );
    assert.deepEqual(await readFile(join(projectPath, oldArchive)), oldBytes);
    await access(join(projectPath, result.migration.assets[0].path));
  },
);
