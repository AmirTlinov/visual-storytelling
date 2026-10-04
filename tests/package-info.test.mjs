import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, cp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  diagnosePackage,
  packageInfo,
  sourceDigest,
  writeBuildInfo,
} from '../tools/build-info.mjs';

async function fixture(root) {
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'dist'), { recursive: true });
  await mkdir(join(root, 'tools'), { recursive: true });
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: '@visual-storytelling/core',
      version: '0.9.0',
      type: 'module',
      files: ['dist', 'tools', 'examples/**/*.js', 'README.md', 'THIRD_PARTY.md'],
      exports: { '.': { import: './dist/index.js' } },
    }),
  );
  await writeFile(join(root, 'src/index.ts'), 'export const value = 1;');
  await writeFile(join(root, 'dist/index.js'), 'export const value = 1;');
  await writeFile(
    join(root, 'dist/api.json'),
    JSON.stringify({ modules: { '.': { value: 'index.d.ts' } } }),
  );
  await writeFile(join(root, 'tools/scene.mjs'), '// shipped CLI');
  await writeBuildInfo(root, join(root, 'dist'), await sourceDigest(root));
}

test('package identity survives installation and detects different content at the same version', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-package-info-'));
  try {
    const cli = join(directory, 'library'),
      scene = join(directory, 'scene');
    await fixture(cli);
    const installed = join(scene, 'node_modules/@visual-storytelling/core');
    await mkdir(installed, { recursive: true });
    for (const name of ['package.json', 'dist', 'tools'])
      await cp(join(cli, name), join(installed, name), { recursive: true });
    await writeFile(
      join(scene, 'package.json'),
      JSON.stringify({ dependencies: { '@visual-storytelling/core': 'file:./pinned.tgz' } }),
    );
    let report = await diagnosePackage(cli, scene);
    assert.equal(report.cli.status, 'current');
    assert.equal(report.consumer.status, 'packaged');
    assert.equal(report.cli.build, report.consumer.build);
    assert.deepEqual(report.issues, []);
    await writeFile(join(installed, 'tools/scene.mjs'), '// different CLI at the same version');
    report = await diagnosePackage(cli, scene);
    assert.equal(report.cli.version, report.consumer.version);
    assert.notEqual(report.cli.build, report.consumer.build);
    assert(report.issues.some((issue) => issue.includes('different package')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('package identity follows npm contents, including notices and excluding unshipped outputs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-packlist-'));
  const root = join(directory, 'library'),
    installed = join(directory, 'installed');
  const run = promisify(execFile);
  try {
    await fixture(root);
    await writeFile(join(root, 'README.md'), 'Authored guide');
    await writeFile(join(root, 'THIRD_PARTY.md'), 'Dependency notices');
    await writeBuildInfo(root, join(root, 'dist'));
    const before = await packageInfo(root);
    await mkdir(join(root, 'examples'));
    await writeFile(join(root, 'examples/preview.mp4'), 'Unpublished preview');
    assert.equal((await packageInfo(root)).build, before.build);
    const { stdout } = await run(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', directory],
      { cwd: root },
    );
    await mkdir(installed);
    await run('tar', [
      '-xzf',
      join(directory, JSON.parse(stdout)[0].filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    const shipped = await packageInfo(installed);
    assert.equal(shipped.status, 'packaged');
    assert.equal(shipped.build, before.build);
    await writeFile(join(root, 'README.md'), 'Changed guide');
    assert.equal((await packageInfo(root)).status, 'modified');
    await writeFile(join(root, 'README.md'), 'Authored guide');
    await writeFile(join(root, 'THIRD_PARTY.md'), 'Changed license');
    assert.equal((await packageInfo(root)).status, 'modified');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('diagnosis distinguishes stale source, modified runtime and pre-receipt packages', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-package-stale-'));
  try {
    await fixture(directory);
    const original = await packageInfo(directory);
    await writeFile(join(directory, 'src/index.ts'), 'export const value = 2;');
    assert.equal((await packageInfo(directory)).status, 'stale');
    assert.equal((await packageInfo(directory)).build, original.build);
    await writeFile(join(directory, 'dist/index.js'), 'export const value = 2;');
    assert.equal((await packageInfo(directory)).status, 'modified');
    await rm(join(directory, 'dist/build-info.json'));
    assert.equal((await packageInfo(directory)).status, 'unrecorded');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('diagnosis finds inherited packages without a local dependency declaration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-package-inherited-'));
  try {
    const cli = join(directory, 'library'),
      scene = join(directory, 'workspace/scene'),
      installed = join(directory, 'workspace/node_modules/@visual-storytelling/core');
    await fixture(cli);
    await fixture(installed);
    await writeFile(join(installed, 'tools/scene.mjs'), '// inherited package from another build');
    await mkdir(scene, { recursive: true });
    await writeFile(join(scene, 'package.json'), JSON.stringify({ type: 'module' }));
    const report = await diagnosePackage(cli, scene);
    assert.equal(report.consumer.root, (await packageInfo(installed)).root);
    assert.notEqual(report.cli.build, report.consumer.build);
    assert(report.issues.some((issue) => issue.includes('different package')));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('an uninstalled consumer gets a concrete next command', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-package-missing-'));
  try {
    const cli = join(directory, 'library'),
      scene = join(directory, 'scene');
    await fixture(cli);
    await mkdir(scene);
    await writeFile(
      join(scene, 'package.json'),
      JSON.stringify({ dependencies: { '@visual-storytelling/core': 'file:./pinned.tgz' } }),
    );
    const report = await diagnosePackage(cli, scene);
    assert.equal(report.consumer, null);
    assert.match(report.issues[0], /npm install/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
