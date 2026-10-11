import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  mkdtemp,
  mkdir,
  readdir,
  readFile,
  realpath,
  symlink,
  rm,
  writeFile,
  cp,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { sceneGenerator } from '../tools/generate-scene.mjs';
import { createScene } from '../tools/create-scene.mjs';
import { environmentProfile } from '../tools/environment/resources.mjs';

const forms = [
  { id: 'node-svg', fixture: 'svg', runner: 'node' },
  { id: 'python-svg', fixture: 'python-svg', runner: 'python3' },
  { id: 'uv-svg', fixture: 'python-svg', runner: 'uv' },
  { id: 'node-svg-concurrent', fixture: 'svg', runner: 'node' },
];
const root = new URL('../', import.meta.url).pathname;
const execute = promisify(execFile);

test('Node and Python generators declare their actual preparation need', async () => {
  for (const fixture of ['svg', 'python-svg'])
    assert.equal(
      (await sceneGenerator(join(root, 'tests/fixtures', fixture))).python,
      true,
      fixture,
    );
  assert.equal(await sceneGenerator(join(root, 'tests/fixtures/scene-shell')), undefined);
});

test(
  'pinned SVG projects build concurrently through their CLI without system Python, uv or voice models',
  { timeout: process.platform === 'linux' ? 900000 : 300000, skip: !environmentProfile() },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-generators-'));
    try {
      const path = join(directory, 'node-and-shell');
      await mkdir(path);
      await symlink(process.execPath, join(path, 'node'));
      await symlink('/bin/sh', join(path, 'sh'));
      if (process.platform === 'linux') {
        for (const name of ['gzip', 'xz']) await symlink('/usr/bin/' + name, join(path, name));
      }
      const npm = await realpath(join(dirname(process.execPath), 'npm'));
      const data = join(directory, 'data');
      const env = { ...process.env, PATH: path, MPLCONFIGDIR: join(directory, 'matplotlib') };
      for (const key of Object.keys(env))
        if (key.startsWith('VISUAL_STORY_') || key.startsWith('UV_')) delete env[key];
      env.VISUAL_STORY_DATA_DIR = data;
      const projects = [];
      for (const { id, fixture, runner } of forms) {
        const project = join(directory, id);
        await createScene(project, { title: id });
        await rm(join(project, 'index.html'));
        await rm(join(project, 'scene.js'));
        await cp(join(root, 'tests/fixtures', fixture), project, { recursive: true });
        const config = JSON.parse(await readFile(join(project, 'scene.json'), 'utf8'));
        config.generator.runner = runner;
        await writeFile(join(project, 'scene.json'), JSON.stringify(config));
        assert.equal((await sceneGenerator(project)).python, true, id);
        await execute(
          process.execPath,
          [npm, 'ci', '--ignore-scripts', '--no-audit', '--no-fund'],
          {
            cwd: project,
            maxBuffer: 4_000_000,
          },
        );
        projects.push(project);
      }
      // Independent CLI processes share exactly one cold resource preparation.
      const built = await Promise.allSettled(
        projects.map((project) =>
          execute(process.execPath, [npm, 'run', 'build'], {
            cwd: project,
            env,
            maxBuffer: 4_000_000,
            timeout: process.platform === 'linux' ? 900000 : 180000,
          }),
        ),
      );
      for (const result of built) {
        if (result.status === 'rejected') throw result.reason;
      }
      for (const project of projects) {
        const svg = await readFile(join(project, 'dist/subject.svg'), 'utf8');
        assert.match(svg, /<svg\b/);
        assert.match(svg, /id="ve-shared-ink"/);
        assert.match(await readFile(join(project, 'dist/index.html'), 'utf8'), /<html\b/i);
      }
      const prepared = await readdir(join(data, 'environment'));
      assert.ok(prepared.includes('python'));
      assert.ok(prepared.some((name) => name.startsWith('uv-')));
      assert.ok(!prepared.some((name) => name.startsWith('higgs-')));
      assert.ok(!prepared.some((name) => /\.lock|\.preparing-/.test(name)));
      const evidence = join(root, 'artifacts/coherent-authoring');
      await mkdir(evidence, { recursive: true });
      await writeFile(
        join(evidence, 'cold-cli-entry-fixed.json'),
        JSON.stringify(
          {
            result: 'passed',
            testedAt: new Date().toISOString(),
            command: 'node --test tests/plugin-generators.test.mjs',
            coreBuild: JSON.parse(await readFile(join(root, 'dist/build-info.json'), 'utf8')).build,
            originalIncident: 'cold-cli-entry.json',
            scope: {
              pinnedProjects: true,
              npm: 'ci --ignore-scripts --no-audit --no-fund',
              build: 'npm run build',
              PATH: ['node', 'sh'],
              clearedEnvironmentPrefixes: ['VISUAL_STORY_', 'UV_'],
              dataDirectory: 'isolated temporary directory; removed after verification',
              concurrentProcesses: forms.length,
            },
            forms: forms.map(({ id, runner }) => ({
              id,
              runner,
              built: true,
              svg: 'subject.svg',
              page: 'dist/index.html',
              sharedInk: true,
            })),
            preparedResources: prepared,
            voiceEnvironmentCreated: false,
            lockOrPreparationResidue: false,
          },
          null,
          2,
        ) + '\n',
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
