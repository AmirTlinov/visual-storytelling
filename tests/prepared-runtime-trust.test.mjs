import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertPreparedRuntimeRoot } from '../tools/prepared-runtime-trust.mjs';
import {
  readPreparedRuntime,
  storyDocumentAPI,
  assertPreparedDocument,
} from '../tools/runtime-package.mjs';

test('prepared runtime authority comes from the executable and installer, never an authored path', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'story-runtime-trust-'));
  const previous = process.env.VISUAL_STORY_INSTALL_DIR;
  process.env.VISUAL_STORY_INSTALL_DIR = join(temporary, 'installation');
  const files = ['.installation.json', 'package.json', 'dist/build-info.json', 'dist/index.js'];
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

test('a trusted legacy pin missing the document entry requests explicit migration before importing code', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'story-legacy-api-'));
  const previous = process.env.VISUAL_STORY_INSTALL_DIR;
  process.env.VISUAL_STORY_INSTALL_DIR = join(temporary, 'installation');
  const digest = 'b'.repeat(64),
    version = '0.16.0';
  const installed = join(
    process.env.VISUAL_STORY_INSTALL_DIR,
    'releases',
    `${version}-${digest.slice(0, 16)}`,
  );
  const files = {
    '.installation.json': JSON.stringify({ digest, version }),
    'package.json': JSON.stringify({ name: '@visual-storytelling/core', version, type: 'module' }),
    'dist/build-info.json': JSON.stringify({ package: '@visual-storytelling/core', build: digest }),
    'dist/index.js': 'export {};\n',
    'dist/api.json': '{}',
    'examples/catalog.json': '{}',
  };
  try {
    for (const [name, content] of Object.entries(files)) {
      const file = join(installed, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
      await chmod(file, 0o444);
    }
    await chmod(installed, 0o555);
    await writeFile(
      join(temporary, 'scene-runtime.json'),
      JSON.stringify({
        schemaVersion: 1,
        name: '@visual-storytelling/core',
        version,
        build: digest,
        root: await realpath(installed),
      }),
    );
    await assert.rejects(storyDocumentAPI(temporary), { code: 'runtime_migration_required' });
    await assert.rejects(assertPreparedDocument(temporary), { code: 'runtime_migration_required' });
    await chmod(installed, 0o755);
    const entry = join(installed, 'dist/story/document.js');
    await mkdir(dirname(entry), { recursive: true });
    await writeFile(
      entry,
      [
        'prepareStoryDocument',
        'prepareIllustratedDocument',
        'editStoryDocument',
        'authoredInputKeys',
      ]
        .map((name) => `export function ${name}() {}`)
        .join('\n'),
    );
    await chmod(entry, 0o444);
    const owner = join(installed, 'tools/runtime-package.mjs');
    await mkdir(dirname(owner), { recursive: true });
    await writeFile(
      owner,
      'export function assertPreparedExplanation() { throw Error("legacy code must not execute"); }',
    );
    await chmod(owner, 0o444);
    await chmod(installed, 0o555);
    await assert.rejects(assertPreparedDocument(temporary), { code: 'runtime_migration_required' });
  } finally {
    if (previous === undefined) delete process.env.VISUAL_STORY_INSTALL_DIR;
    else process.env.VISUAL_STORY_INSTALL_DIR = previous;
    await chmod(installed, 0o755).catch(() => {});
    await rm(temporary, { recursive: true, force: true });
  }
});
