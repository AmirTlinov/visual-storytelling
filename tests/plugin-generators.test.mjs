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
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { sceneGenerator } from '../tools/generate-scene.mjs';
import { createScene } from '../tools/create-scene.mjs';

const examples = ['logic-gates', 'lc-oscillator', 'parameter-cube', 'geometric-tensor'];
const root = new URL('../', import.meta.url).pathname;
const execute = promisify(execFile);

test('all Python-backed catalog generators declare their actual preparation need', async () => {
  for (const id of examples)
    assert.equal((await sceneGenerator(join(root, 'examples', id))).python, true, id);
  assert.equal(await sceneGenerator(join(root, 'examples/explorer-svg')), undefined);
});

test(
  'pinned SVG projects build concurrently through their CLI without system Python, uv or voice models',
  { timeout: 300000, skip: process.platform !== 'darwin' || process.arch !== 'arm64' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-generators-'));
    try {
      const path = join(directory, 'node-and-shell');
      await mkdir(path);
      await symlink(process.execPath, join(path, 'node'));
      await symlink('/bin/sh', join(path, 'sh'));
      const npm = await realpath(join(dirname(process.execPath), 'npm'));
      const data = join(directory, 'data');
      const env = { ...process.env, PATH: path, MPLCONFIGDIR: join(directory, 'matplotlib') };
      for (const key of Object.keys(env))
        if (key.startsWith('VISUAL_STORY_') || key.startsWith('UV_')) delete env[key];
      env.VISUAL_STORY_DATA_DIR = data;
      const projects = [];
      for (const example of examples) {
        const project = join(directory, example);
        await createScene(project, { example, deferAudio: true });
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
            timeout: 180000,
          }),
        ),
      );
      for (const result of built) {
        if (result.status === 'rejected') throw result.reason;
      }
      for (const [index, file] of [
        'logic-gates.svg',
        'LC-oscillator.svg',
        'tensor-cube.svg',
        'geometric-tensor.svg',
      ].entries()) {
        const svg = await readFile(join(projects[index], 'dist', file), 'utf8');
        assert.match(svg, /<svg\b/);
        assert.match(svg, /id="ve-shared-ink"/);
        assert.match(await readFile(join(projects[index], 'dist/index.html'), 'utf8'), /<html\b/i);
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
              concurrentProcesses: 4,
            },
            forms: examples.map((example, index) => ({
              example,
              built: true,
              svg: [
                'logic-gates.svg',
                'LC-oscillator.svg',
                'tensor-cube.svg',
                'geometric-tensor.svg',
              ][index],
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
