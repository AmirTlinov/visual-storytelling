import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  chmod,
  rename,
  rm,
  cp,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeBuildInfo } from '../tools/build-info.mjs';
import { releaseDigest } from '../plugin/install.mjs';
import { pinSceneProject } from '../tools/scene-project.mjs';
import { updateSceneRuntime, linkPreparedRuntime } from '../tools/runtime-package.mjs';
import { readPreparedRuntime } from '../tools/runtime-reference.mjs';
import { ProjectStore } from '../plugin/projects.mjs';

async function permissions(directory, immutable) {
  await chmod(directory, immutable ? 0o555 : 0o700);
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isDirectory()) await permissions(file, immutable);
    else if (item.isFile()) await chmod(file, immutable ? 0o444 : 0o600);
  }
}

async function release(installation, value) {
  const staging = join(installation, 'releases', 'staging-' + value);
  await mkdir(join(staging, 'dist'), { recursive: true });
  await mkdir(join(staging, 'dist/explanation'), { recursive: true });
  await mkdir(join(staging, 'tools/explanation'), { recursive: true });
  await mkdir(join(staging, 'plugin/dist'), { recursive: true });
  await writeFile(
    join(staging, 'package.json'),
    JSON.stringify({
      name: '@visual-storytelling/core',
      version: '0.0.1',
      type: 'module',
      files: ['dist', 'tools'],
      exports: './dist/index.js',
    }),
  );
  await writeFile(join(staging, 'dist/index.js'), `export const value = ${value};\n`);
  await writeFile(join(staging, 'dist/explanation/document.js'), 'export {};\n');
  await writeFile(join(staging, 'dist/api.json'), JSON.stringify({ modules: {} }));
  await writeFile(join(staging, 'tools/explanation/scene.js'), 'export {};\n');
  await writeFile(join(staging, 'tools/explanation/index.html'), '<main></main>');
  await writeFile(join(staging, 'plugin/dist/live.html'), '<main>Prepared fixture</main>');
  const receipt = await writeBuildInfo(staging, join(staging, 'dist'));
  await writeFile(
    join(staging, 'release.json'),
    JSON.stringify({ core: { build: receipt.build } }),
  );
  const digest = await releaseDigest(staging);
  const root = join(installation, 'releases', '0.0.1-' + digest.slice(0, 16));
  await writeFile(
    join(staging, '.installation.json'),
    JSON.stringify({ version: '0.0.1', digest }),
  );
  await permissions(staging, true);
  await rename(staging, root);
  return root;
}

test('prepared migration and undo move the pin with its dependency; cancellation restores all metadata and the link', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'prepared-runtime-migration-')));
  const installation = join(directory, 'installation');
  const previousInstallation = process.env.VISUAL_STORY_INSTALL_DIR;
  process.env.VISUAL_STORY_INSTALL_DIR = installation;
  t.after(async () => {
    if (previousInstallation === undefined) delete process.env.VISUAL_STORY_INSTALL_DIR;
    else process.env.VISUAL_STORY_INSTALL_DIR = previousInstallation;
    await permissions(directory, false);
    await rm(directory, { recursive: true, force: true });
  });
  const first = await release(installation, 1);
  const second = await release(installation, 2);
  const projectPath = join(directory, 'project');
  await mkdir(projectPath);
  await pinSceneProject(projectPath, { root: first, prepared: true });
  await writeFile(
    join(projectPath, 'index.html'),
    '<main></main><script type="module" src="scene.js"></script>',
  );
  await writeFile(join(projectPath, 'scene.js'), 'export {};\n');
  const projects = new ProjectStore(join(directory, 'data'));
  const project = await projects.register(projectPath);
  const metadata = ['package.json', 'scene-runtime.json'];
  const original = await Promise.all(
    metadata.map((file) => readFile(join(projectPath, file), 'utf8')),
  );
  const snapshot = join(directory, 'candidate');
  await cp(projectPath, snapshot, {
    recursive: true,
    filter: (file) => !file.includes('node_modules'),
  });
  const changed = await updateSceneRuntime(snapshot, { root: second, build: false });
  assert.equal(changed.prepared, true);
  assert.equal((await readPreparedRuntime(snapshot)).root, second);
  assert.equal(
    (await readPreparedRuntime(projectPath)).root,
    first,
    'candidate cannot change working metadata',
  );
  const accepted = await projects.edit({
    projectId: project.id,
    sourceRevision: project.sourceRevision,
    requestId: randomUUID(),
    changes: [
      ...(await Promise.all(
        metadata.map(async (path) => ({
          path,
          content: await readFile(join(snapshot, path), 'utf8'),
        })),
      )),
      { path: 'package-lock.json', content: null },
    ],
  });
  await linkPreparedRuntime(projectPath);
  assert.equal((await readPreparedRuntime(projectPath)).root, second);
  assert.equal(await realpath(join(projectPath, 'node_modules/@visual-storytelling/core')), second);
  await projects.edit({
    projectId: project.id,
    sourceRevision: accepted.sourceRevision,
    requestId: randomUUID(),
    undo: true,
  });
  await linkPreparedRuntime(projectPath);
  assert.equal((await readPreparedRuntime(projectPath)).root, first);
  assert.equal(await realpath(join(projectPath, 'node_modules/@visual-storytelling/core')), first);
  assert.deepEqual(
    await Promise.all(metadata.map((file) => readFile(join(projectPath, file), 'utf8'))),
    original,
  );

  const controller = new AbortController();
  const check = controller.signal.throwIfAborted.bind(controller.signal);
  let checks = 0;
  t.mock.method(controller.signal, 'throwIfAborted', () => {
    if (++checks === 3) controller.abort(new Error('Cancelled after dependency link changed'));
    check();
  });
  await assert.rejects(
    updateSceneRuntime(projectPath, {
      root: second,
      build: false,
      signal: controller.signal,
    }),
    /prepared pin restored.*Previous dependencies restored/,
  );
  assert.equal(await realpath(join(projectPath, 'node_modules/@visual-storytelling/core')), first);
  assert.deepEqual(
    await Promise.all(metadata.map((file) => readFile(join(projectPath, file), 'utf8'))),
    original,
  );
  assert.ok(!(await readdir(projectPath)).includes('package-lock.json'));
  assert.ok(!(await readdir(projectPath)).includes('dependencies'));
});
