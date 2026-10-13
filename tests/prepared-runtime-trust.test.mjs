import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPreparedRuntimeRoot } from '../tools/prepared-runtime-trust.mjs';
import { readPreparedRuntime } from '../tools/runtime-package.mjs';

test('prepared runtime authority comes from the executable and installer, never an authored path', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'story-runtime-trust-'));
  const previous = process.env.VISUAL_STORY_INSTALL_DIR;
  process.env.VISUAL_STORY_INSTALL_DIR = join(temporary, 'installation');
  const files = [
    '.installation.json',
    'package.json',
    'dist/build-info.json',
    'dist/index.js',
    'dist/story/document.js',
  ];
  let installed;
  try {
    assert.equal(
      await assertPreparedRuntimeRoot(fileURLToPath(new URL('../', import.meta.url))),
      fileURLToPath(new URL('../', import.meta.url)).replace(/\/$/, ''),
    );
    const outside = join(temporary, 'project/runtime');
    await mkdir(outside, { recursive: true });
    await assert.rejects(assertPreparedRuntimeRoot(outside), /installed immutable/);
    await writeFile(
      join(temporary, 'scene-runtime.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: '@visual-storytelling/core',
        version: '0.17.0',
        build: 'a'.repeat(64),
        root: await realpath(outside),
      }),
    );
    await assert.rejects(readPreparedRuntime(temporary), /installed immutable/);
    const digest = 'a'.repeat(64),
      version = '0.17.0';
    installed = join(
      process.env.VISUAL_STORY_INSTALL_DIR,
      'releases',
      `${version}-${digest.slice(0, 16)}`,
    );
    for (const name of files) {
      const file = join(installed, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(
        file,
        name === '.installation.json' ? JSON.stringify({ digest, version }) : '{}',
      );
      await chmod(file, 0o444);
    }
    await assert.rejects(assertPreparedRuntimeRoot(installed), /installed immutable/);
    await chmod(installed, 0o555);
    assert.equal(await assertPreparedRuntimeRoot(installed), await realpath(installed));
    await chmod(join(installed, 'dist/index.js'), 0o644);
    await assert.rejects(assertPreparedRuntimeRoot(installed), /installed immutable/);
    await chmod(join(installed, 'dist/index.js'), 0o444);
    await chmod(join(installed, 'dist/story/document.js'), 0o644);
    await assert.rejects(
      assertPreparedRuntimeRoot(installed, { modules: ['dist/story/document.js'] }),
      /installed immutable/,
    );
    await chmod(join(installed, 'dist/story/document.js'), 0o444);
    assert.equal(
      await assertPreparedRuntimeRoot(installed, { modules: ['dist/story/document.js'] }),
      await realpath(installed),
    );
    const linked = join(process.env.VISUAL_STORY_INSTALL_DIR, 'releases', 'linked');
    await symlink(outside, linked);
    await assert.rejects(assertPreparedRuntimeRoot(linked), /installed immutable/);
  } finally {
    if (previous === undefined) delete process.env.VISUAL_STORY_INSTALL_DIR;
    else process.env.VISUAL_STORY_INSTALL_DIR = previous;
    if (installed) await chmod(installed, 0o755);
    await rm(temporary, { recursive: true, force: true });
  }
});
