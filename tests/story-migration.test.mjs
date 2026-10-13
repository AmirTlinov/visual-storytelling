import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  chmod,
  rename,
  rm,
  cp,
  realpath,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeBuildInfo } from '../tools/build-info.mjs';
import { releaseDigest } from '../plugin/install.mjs';
import { pinSceneProject } from '../tools/scene-project.mjs';
import {
  assertPreparedStory,
  readPreparedRuntime,
  updateSceneRuntime,
  linkPreparedRuntime,
} from '../tools/runtime-package.mjs';
import { legacyStoryChanges } from '../tools/story-migration.mjs';
import { ProjectStore, prepareProjectChanges, writeProjectChange } from '../plugin/projects.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = join(root, '.plugin-release');
const json = async (file) => JSON.parse(await readFile(file, 'utf8'));
async function permissions(directory, immutable) {
  await chmod(directory, immutable ? 0o555 : 0o700);
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = join(directory, item.name);
    if (item.isDirectory()) await permissions(file, immutable);
    else if (item.isFile()) await chmod(file, immutable ? 0o444 : 0o600);
  }
}
async function oldRelease(installation) {
  const staging = join(installation, 'releases', 'staging');
  for (const folder of ['dist/explanation', 'tools/explanation', 'plugin/dist'])
    await mkdir(join(staging, folder), { recursive: true });
  const files = {
    'package.json': JSON.stringify({
      name: '@visual-storytelling/core',
      version: '0.0.1',
      type: 'module',
      files: ['dist', 'tools'],
      exports: './dist/index.js',
    }),
    'dist/index.js': 'export const legacy = true;\n',
    'dist/api.json': JSON.stringify({ modules: {} }),
    // A test copy of the old contract; no legacy parser ships in the new library.
    'dist/explanation/document.js': 'export const validateExplanation = value => value;\n',
    'tools/explanation/scene.js': 'export const legacy = true;\n',
    'tools/explanation/index.html':
      '<title>Legacy</title><main></main><script type="module" src="scene.js"></script>',
    'plugin/dist/live.html': '<main>Legacy fixture</main>',
  };
  for (const [path, content] of Object.entries(files))
    await writeFile(join(staging, path), content);
  const receipt = await writeBuildInfo(staging, join(staging, 'dist'));
  await writeFile(
    join(staging, 'release.json'),
    JSON.stringify({ core: { build: receipt.build } }),
  );
  const digest = await releaseDigest(staging);
  await writeFile(
    join(staging, '.installation.json'),
    JSON.stringify({ version: '0.0.1', digest }),
  );
  const release = join(installation, 'releases', '0.0.1-' + digest.slice(0, 16));
  await permissions(staging, true);
  await rename(staging, release);
  return release;
}

test('explicit document migration validates a copy, recovers one source/pin transaction, retries and undoes without losing the legacy pin', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'story-document-migration-')));
  const installation = join(directory, 'installation');
  const previousInstallation = process.env.VISUAL_STORY_INSTALL_DIR;
  process.env.VISUAL_STORY_INSTALL_DIR = installation;
  t.after(async () => {
    if (previousInstallation === undefined) delete process.env.VISUAL_STORY_INSTALL_DIR;
    else process.env.VISUAL_STORY_INSTALL_DIR = previousInstallation;
    await permissions(directory, false);
    await rm(directory, { recursive: true, force: true });
  });
  const previous = await oldRelease(installation);
  const projectPath = join(directory, 'project');
  await mkdir(projectPath);
  await pinSceneProject(projectPath, { root: previous, prepared: true });
  for (const file of ['scene.js', 'index.html']) {
    await cp(join(previous, 'tools/explanation', file), join(projectPath, file));
    await chmod(join(projectPath, file), 0o600);
  }
  const legacy = {
    version: 1,
    model: { id: 'apples', kind: 'division', count: 17, divisor: 5 },
    views: [{ id: 'groups', kind: 'groups', model: 'apples' }],
    score: [
      { id: 'collect', action: 'group', seconds: 3, text: 'Группы' },
      { id: 'look', hold: true, seconds: 2 },
    ],
  };
  await writeFile(join(projectPath, 'explanation.json'), JSON.stringify(legacy));
  const projects = new ProjectStore(join(directory, 'data'));
  const project = await projects.register(projectPath);
  const originalPin = await json(join(projectPath, 'scene-runtime.json'));
  await assert.rejects(assertPreparedStory(projectPath), /explicit story_migrate/);
  const candidate = join(directory, 'candidate');
  await cp(projectPath, candidate, {
    recursive: true,
    filter: (file) => !file.includes('node_modules'),
  });
  const edits = await legacyStoryChanges(candidate, { root: target });
  assert.equal(
    await readFile(join(projectPath, 'explanation.json'), 'utf8'),
    JSON.stringify(legacy),
  );
  assert.equal((await readPreparedRuntime(projectPath)).root, previous);
  const converted = JSON.parse(edits.find((edit) => edit.path === 'story.json').content);
  assert.deepEqual(converted.models, [
    { id: 'apples', kind: 'division', inputs: { count: 17, divisor: 5 } },
  ]);
  assert.equal(converted.chapters[0].beats[0].say, '');
  assert.equal(converted.chapters[0].beats[0].staging.operation, 'group');
  assert.equal(typeof converted.chapters[0].beats[1].hold, 'string');
  for (const edit of await prepareProjectChanges(candidate, edits))
    await writeProjectChange(candidate, edit);
  await updateSceneRuntime(candidate, { root: target, build: false });
  const changes = [
    ...edits,
    ...(await Promise.all(
      ['package.json', 'package-lock.json', 'scene-runtime.json'].map(async (path) => ({
        path,
        content: await readFile(join(candidate, path), 'utf8').catch((error) => {
          if (error.code !== 'ENOENT') throw error;
          return null;
        }),
      })),
    )),
  ];
  const request = {
    projectId: project.id,
    sourceRevision: project.sourceRevision,
    requestId: randomUUID(),
    changes,
  };
  const write = projects.write.bind(projects);
  let interrupted = false;
  projects.write = async (path, entry) => {
    if (!interrupted && entry.path === 'scene.js') {
      interrupted = true;
      throw new Error('Interrupted migration publication');
    }
    return write(path, entry);
  };
  await assert.rejects(projects.edit(request), /Interrupted migration publication/);
  projects.write = write;
  const migrated = await projects.edit(request);
  await linkPreparedRuntime(projectPath);
  assert.equal(migrated.repeated, true, 'retry recovers the existing transaction');
  assert.equal((await readPreparedRuntime(projectPath)).root, await realpath(target));
  assert.deepEqual(await json(join(projectPath, 'story.json')), converted);
  await assert.rejects(readFile(join(projectPath, 'explanation.json')), { code: 'ENOENT' });
  assert.deepEqual(await legacyStoryChanges(projectPath, { root: target }), []);
  await assertPreparedStory(projectPath);
  await projects.edit({
    projectId: project.id,
    sourceRevision: migrated.sourceRevision,
    requestId: randomUUID(),
    undo: true,
  });
  await linkPreparedRuntime(projectPath);
  assert.deepEqual(await json(join(projectPath, 'scene-runtime.json')), originalPin);
  assert.deepEqual(await json(join(projectPath, 'explanation.json')), legacy);
  await assert.rejects(readFile(join(projectPath, 'story.json')), { code: 'ENOENT' });

  await writeFile(join(projectPath, 'scene.js'), 'export const custom = true;');
  await assert.rejects(legacyStoryChanges(projectPath, { root: target }), /custom source code/);
  assert.deepEqual(await json(join(projectPath, 'scene-runtime.json')), originalPin);
});

test('unversioned authored chapters migrate explicitly; invalid candidates leave the source unchanged and can be retried', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-chapters-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'story.json');
  const previous = {
    title: 'Chapter',
    chapters: [
      {
        id: 'chapter',
        title: 'Chapter',
        beats: [{ id: 'start', say: '', action: 'Reveal the model', seconds: 2 }],
      },
    ],
  };
  await writeFile(
    file,
    JSON.stringify({
      ...previous,
      chapters: [{ ...previous.chapters[0], beats: [{ id: 'bad', seconds: -1 }] }],
    }),
  );
  const bad = await readFile(file, 'utf8');
  await assert.rejects(legacyStoryChanges(directory, { root: target }));
  assert.equal(await readFile(file, 'utf8'), bad);
  await writeFile(file, JSON.stringify(previous));
  const changes = await legacyStoryChanges(directory, { root: target });
  assert.deepEqual(JSON.parse(changes[0].content), {
    version: 1,
    models: [],
    views: [],
    ...previous,
  });
  assert.equal(
    await readFile(file, 'utf8'),
    JSON.stringify(previous),
    'preparing migration never writes the working source',
  );
  assert.deepEqual(
    await legacyStoryChanges(directory, { root: target }),
    changes,
    'retry prepares the same complete candidate',
  );
});

test('explicit canonical migration rejects invalid authored data before a candidate pin or source can publish', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'story-canonical-migration-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'story.json');
  const invalid = {
    version: 1,
    models: [{ id: 'division', kind: 'division', inputs: { count: -1, divisor: 5 } }],
    views: [{ id: 'groups', kind: 'groups', model: 'division' }],
    chapters: [],
  };
  const content = JSON.stringify(invalid);
  await writeFile(file, content);
  await assert.rejects(legacyStoryChanges(directory, { root: target }), /inputs.count/);
  assert.equal(await readFile(file, 'utf8'), content);
  await writeFile(
    file,
    JSON.stringify({
      ...invalid,
      models: [{ ...invalid.models[0], inputs: { count: 17, divisor: 5 } }],
    }),
  );
  assert.deepEqual(await legacyStoryChanges(directory, { root: target }), []);
});
