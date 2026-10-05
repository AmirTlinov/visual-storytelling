import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, writeFile, rm, cp, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { packageInfo, writeBuildInfo } from '../tools/build-info.mjs';
import { packRuntime, updateSceneRuntime } from '../tools/runtime-package.mjs';

const run = promisify(execFile);
const runtime = '@visual-storytelling/core';
const readJSON = async (path) => JSON.parse(await readFile(path, 'utf8'));
const hash = (data) => createHash('sha256').update(data).digest('hex');
const install = (cwd) =>
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd });

async function fixture(directory) {
  const root = join(directory, 'library');
  await mkdir(join(root, 'src'), { recursive: true });
  await mkdir(join(root, 'dist'));
  await mkdir(join(root, 'tools'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({
      name: runtime,
      version: '0.0.1',
      type: 'module',
      files: ['dist', 'tools'],
      exports: { '.': './dist/index.js' },
    }),
  );
  await writeFile(
    join(root, 'dist/api.json'),
    JSON.stringify({ modules: { '.': { value: 'index.d.ts' } } }),
  );
  // The fixture exercises the source-build branch without building the library under test.
  await writeFile(
    join(root, 'tools/build-package.mjs'),
    `
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { writeBuildInfo } from ${JSON.stringify(new URL('../tools/build-info.mjs', import.meta.url).href)};
const root = fileURLToPath(new URL('../', import.meta.url));
await writeFile(root + '/dist/index.js', await readFile(root + '/src/index.ts'));
await writeBuildInfo(root, root + '/dist');
`,
  );
  await revision(root, 1);
  return root;
}
async function revision(root, value, manifest = {}) {
  await writeFile(join(root, 'src/index.ts'), `export const value = ${value};\n`);
  await writeFile(join(root, 'dist/index.js'), `export const value = ${value};\n`);
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ ...(await readJSON(join(root, 'package.json'))), ...manifest }),
  );
  return writeBuildInfo(root, join(root, 'dist'));
}
async function scene(directory, root, owner = 'dependencies') {
  const target = join(directory, 'scene');
  const packed = await packRuntime(target, { root, build: false });
  await writeFile(
    join(target, 'package.json'),
    JSON.stringify(
      {
        name: 'my-authored-scene',
        version: '1.0.0',
        private: true,
        type: 'module',
        scripts: {
          build: 'echo authored-build',
          install: "node -e \"require('fs').writeFileSync('script-ran','bad')\"",
        },
        [owner]: { [runtime]: packed.dependency },
        authored: { project: 'Keep my data' },
      },
      null,
      4,
    ) + '\n',
  );
  await install(target);
  return { target, packed };
}
async function importedValue(target) {
  return JSON.parse(
    (
      await run(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { value } from '${runtime}'; console.log(JSON.stringify(value));`,
        ],
        { cwd: target },
      )
    ).stdout,
  );
}
async function observeNpm(directory, callback, mutate) {
  const { stdout } = await run('which', ['npm']);
  const real = stdout.trim();
  const bin = join(directory, 'npm-observer'),
    log = join(bin, 'commands.jsonl');
  await mkdir(bin);
  await writeFile(
    join(bin, 'npm'),
    `#!${process.execPath}
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const result = spawnSync(${JSON.stringify(real)}, args, {stdio:'inherit'});
if (${JSON.stringify(mutate ?? null)} && args[0] === 'pack' && !args.includes('--dry-run') && result.status === 0)
  fs.appendFileSync(${JSON.stringify(mutate ?? '')}, '\\n// edit while npm was packing');
process.exit(result.status ?? 1);
`,
  );
  await chmod(join(bin, 'npm'), 0o755);
  const original = process.env.PATH;
  process.env.PATH = `${bin}:${original}`;
  try {
    await callback(async () =>
      (await readFile(log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse),
    );
  } finally {
    process.env.PATH = original;
  }
}

test('update replaces same-version bytes, preserves authored project, and skips a repeated installation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-update-'));
  try {
    const root = await fixture(directory);
    const { target, packed } = await scene(directory, root, 'devDependencies');
    const helper = join(directory, 'helper');
    await mkdir(helper);
    await writeFile(
      join(helper, 'package.json'),
      JSON.stringify({ name: 'my-other-dependency', version: '1.0.0', main: 'index.js' }),
    );
    await writeFile(join(helper, 'index.js'), 'module.exports = 7;');
    const authored = await readJSON(join(target, 'package.json'));
    authored.dependencies = { 'my-other-dependency': 'file:../helper' };
    await writeFile(join(target, 'package.json'), JSON.stringify(authored, null, 4) + '\n');
    await install(target);
    const unrelated = (await readJSON(join(target, 'package-lock.json'))).packages[
      'node_modules/my-other-dependency'
    ];
    const expected = await revision(root, 2);
    const result = await updateSceneRuntime(target, { root, build: false });
    assert.equal(result.changed, true);
    assert.equal(result.build, expected.build);
    assert.equal(await importedValue(target), 2);
    const after = await readJSON(join(target, 'package.json'));
    assert.deepEqual({ ...after, devDependencies: authored.devDependencies }, authored);
    assert.deepEqual(
      (await readJSON(join(target, 'package-lock.json'))).packages[
        'node_modules/my-other-dependency'
      ],
      unrelated,
    );
    assert(!(await readdir(target)).includes('script-ran'));
    assert(
      !(await readdir(join(target, 'dependencies'))).includes(packed.filename.split('/').at(-1)),
    );
    const bytes = await readFile(join(target, result.dependency.slice(5)));
    assert(result.dependency.endsWith(`${hash(bytes)}.tgz`));
    const manifest = await readFile(join(target, 'package.json'));
    const lock = await readFile(join(target, 'package-lock.json'));
    await observeNpm(directory, async (commands) => {
      const again = await updateSceneRuntime(target, { root, build: false });
      assert.equal(again.changed, false);
      assert(
        !(await commands()).some(
          (args) => args[0] === 'install' || (args[0] === 'pack' && !args.includes('--dry-run')),
        ),
      );
    });
    assert((await readFile(join(target, 'package.json'))).equals(manifest));
    assert((await readFile(join(target, 'package-lock.json'))).equals(lock));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed optional installation restores metadata and the previously installed build', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-rollback-'));
  try {
    const root = await fixture(directory);
    const { target, packed } = await scene(directory, root, 'optionalDependencies');
    const before = await readFile(join(target, 'package.json'));
    const lock = await readFile(join(target, 'package-lock.json'));
    await writeFile(join(target, '.npmrc'), 'engine-strict=true\n');
    await revision(root, 2, { engines: { node: '>=999' } });
    await assert.rejects(
      updateSceneRuntime(target, { root, build: false }),
      /Runtime update failed; package.json and lockfile restored.*Previous dependencies restored/s,
    );
    assert((await readFile(join(target, 'package.json'))).equals(before));
    assert((await readFile(join(target, 'package-lock.json'))).equals(lock));
    assert.equal(await importedValue(target), 1);
    assert.deepEqual(await readdir(join(target, 'dependencies')), [
      packed.filename.split('/').at(-1),
    ]);
    assert.equal(
      (await packageInfo(join(target, 'node_modules/@visual-storytelling/core'))).build,
      packed.build,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('source races never publish an archive; installed packages and automatic source builds share the same path', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-pack-'));
  try {
    const root = await fixture(directory);
    const target = join(directory, 'packed');
    await observeNpm(
      directory,
      async () => {
        await assert.rejects(packRuntime(target, { root, build: false }), /changed during packing/);
      },
      join(root, 'src/index.ts'),
    );
    await assert.rejects(readFile(join(target, 'package.json')), { code: 'ENOENT' });
    await assert.rejects(readdir(join(target, 'dependencies')), { code: 'ENOENT' });
    await writeFile(join(root, 'src/index.ts'), 'export const value = 3;\n');
    const built = await packRuntime(target, { root });
    assert.equal((await packageInfo(root)).status, 'current');
    const installed = join(directory, 'installed');
    await mkdir(installed);
    await run('tar', [
      '-xzf',
      join(target, built.filename),
      '-C',
      installed,
      '--strip-components=1',
    ]);
    assert.equal((await packageInfo(installed)).status, 'packaged');
    const repacked = await packRuntime(join(directory, 'repacked'), { root: installed });
    assert.equal(repacked.build, built.build);
    assert.equal(repacked.filename, built.filename);
    // Existing owned names are immutable, even if a caller has damaged the file.
    await writeFile(join(target, built.filename), 'unrelated content');
    await assert.rejects(packRuntime(target, { root: installed }), /different content/);
    assert.equal(await readFile(join(target, built.filename), 'utf8'), 'unrelated content');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('cleanup preserves legacy root archives and normalized aliases to an older managed archive', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'runtime-owned-files-'));
  try {
    const root = await fixture(directory);
    const { target, packed } = await scene(directory, root);
    const before = await readJSON(join(target, 'package.json'));
    before.dependencies.archiveAlias = `file:${packed.filename}`;
    await writeFile(join(target, 'package.json'), JSON.stringify(before));
    await install(target);
    await revision(root, 2);
    await updateSceneRuntime(target, { root, build: false });
    assert.equal(
      (
        await run('tar', ['-xOf', join(target, packed.filename), 'package/package.json'])
      ).stdout.includes(runtime),
      true,
    );
    const manifest = await readJSON(join(target, 'package.json'));
    const legacy = 'visual-storytelling-core-0.0.1.tgz';
    await cp(join(target, manifest.dependencies[runtime].slice(5)), join(target, legacy));
    manifest.dependencies[runtime] = `file:./${legacy}`;
    await writeFile(join(target, 'package.json'), JSON.stringify(manifest));
    await install(target);
    await revision(root, 3);
    await updateSceneRuntime(target, { root, build: false });
    assert((await readFile(join(target, legacy))).length > 0);
    assert.equal(await importedValue(target), 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
