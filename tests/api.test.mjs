import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readdir, copyFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildAPI, describeAPI } from '../tools/api.mjs';

test('CLI discovery respects a runtime without character and Higgs authoring tools', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'story-profile-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const tools = fileURLToPath(new URL('../tools', import.meta.url));
  await mkdir(join(root, 'tools'));
  await writeFile(
    join(root, 'package.json'),
    JSON.stringify({ type: 'module', exports: {}, bin: {} }),
  );
  // Run the real CLI against this package profile; shared owners remain their original files.
  for (const name of await readdir(tools))
    if (name === 'scene.mjs') await copyFile(join(tools, name), join(root, 'tools', name));
    else if (name !== 'characters') await symlink(join(tools, name), join(root, 'tools', name));
  const run = (...args) =>
    promisify(execFile)(process.execPath, [join(root, 'tools/scene.mjs'), ...args]);
  const help = (await run('--help')).stdout;
  assert.doesNotMatch(help, /characters --help/);
  assert.match(help, /--audio/);
  assert.match(help, /--silent/);
  const creation = (await run('new', '--help')).stdout;
  assert.match(creation, /story_voice/);
  assert.match(creation, /local neural Higgs/);
  assert.match(creation, /provider.*macos/);
  await assert.rejects(run('characters', '--help'), (error) => {
    assert.match(error.stderr, /does not include \.\/characters/);
    assert.doesNotMatch(error.stderr, /ERR_MODULE_NOT_FOUND/);
    return true;
  });
});

test('one morph lookup explains its inputs without unrelated implementation helpers', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const { text, missing } = await describeAPI(root, 'Morph3D', 'Morph2D', 'Morph', '--full');
  assert.deepEqual(missing, []);
  assert.match(text, /import \{ Morph3D \} from '@visual-storytelling\/core\/three'/);
  for (const name of ['MorphOperation', 'MorphObject', 'MorphFrame', 'Frame', 'Cue'])
    assert.equal(
      [...text.matchAll(new RegExp(`export interface ${name}(?:[ <{])`, 'g'))].length,
      1,
    );
  assert.match(text, /export type VolumeShape =/);
  assert.match(text, /export type MorphTime = number \| Frame/);
  assert.doesNotMatch(text, /declare function (?:bodySize|shapeSize|motionProgress)\(/);
  assert.match(text, /Related API: visual-story api Viewport3D/);
  const unknown = await describeAPI(root, 'Viewport');
  assert.equal(unknown.missing.length, 1);
  assert.match(unknown.text, /Viewport3D/);
  const panel = await describeAPI(root, 'MathPanel');
  assert.match(panel.text, /ModelPanel/);
  const method = await describeAPI(root, 'SceneMount.attachStory');
  assert.match(method.text, /import type \{ SceneMount \}/);
  assert.doesNotMatch(
    method.text,
    /declare global|interface SceneHandle|interface ControlParameter/,
  );
  const loader = await describeAPI(root, 'loadGLB');
  assert.deepEqual(loader.missing, []);
  assert.match(loader.text, /import type \{ Viewport3DHandle \}/);
  assert.match(loader.text, /loadGLB\(source: string \| ArrayBuffer\)/);
  const captions = await describeAPI(root, 'captionTrack');
  assert.match(
    captions.text,
    /import \{ captionTrack \} from '@visual-storytelling\/core\/story';/,
  );
  const { captionTrack } = await import('../dist/story/index.js');
  assert.match(
    captionTrack({ segments: [{ id: 'one', start: 0, end: 1, text: 'Готово.' }] }).serialize('srt'),
    /Готово\./,
  );
});

test('shipped discovery resolves private factories, aliases and recursive argument types', async () => {
  const root = await mkdtemp(join(tmpdir(), 'story-api-'));
  try {
    await mkdir(join(root, 'dist'));
    await writeFile(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'public-api-fixture',
        type: 'module',
        exports: {
          '.': { types: './dist/index.d.ts' },
          './alternate': { types: './dist/alternate.d.ts' },
        },
      }),
    );
    await writeFile(
      join(root, 'dist/index.d.ts'),
      `
      import { create } from './factory.js';
      import { makePlot } from './factory.js';
      import { externalFn } from '../external.js';
      export declare const Widget: { create: typeof create };
      export { makePlot as plot } from './factory.js';
      export declare const createPlot: typeof makePlot;
      export type { Input as WidgetInput } from './types.js';
      export { First as Choice } from './shared.js';
      interface Box<T> { value: T }
      export declare const DataBox: Box<string>;
      export declare const CallableBox: Box<typeof externalFn>;
    `,
    );
    await writeFile(join(root, 'external.d.ts'), 'export declare function externalFn(): void;');
    await writeFile(
      join(root, 'dist/factory.d.ts'),
      `
      import type { Input as Options } from './types.js';
      export declare function create(options: Options): { dispose(): void };
      export declare function makePlot(options: Options): {
        readonly version: 'instance';
        interval(name: string, options: Options): { at(from: number, to: number): void };
        dispose(): void;
      };
      export declare namespace makePlot { const version: 'factory' }
      export declare function obsoleteHelper(): void;
    `,
    );
    await writeFile(
      join(root, 'dist/alternate.d.ts'),
      "export { Second as Choice } from './shared.js';",
    );
    await writeFile(
      join(root, 'dist/shared.d.ts'),
      `export declare const First: { first: true };
       export declare const Second: { second: true };`,
    );
    await writeFile(
      join(root, 'dist/types.d.ts'),
      `
      export interface Input { title: string; child?: Input }
      export interface Unrelated { unused: true }
    `,
    );
    await buildAPI(root, join(root, 'dist'));
    const { text, missing } = await describeAPI(root, 'Widget');
    assert.deepEqual(missing, []);
    const absent = await describeAPI(root, './characters');
    assert.deepEqual(absent.missing, [
      'No public entry point "./characters" in this runtime. Available: ., ./alternate.',
    ]);
    assert.doesNotMatch(absent.text, /Matches:/);
    assert.match(text, /declare function create\(options: Options\)/);
    assert.match(text, /Input as Options/);
    assert.match(text, /import type \{ WidgetInput \} from 'public-api-fixture'/);
    assert.equal([...text.matchAll(/export interface Input/g)].length, 1);
    assert.doesNotMatch(text, /obsoleteHelper|Unrelated/);
    const choices = await describeAPI(root, 'Choice');
    assert.deepEqual(choices.missing, []);
    assert.match(choices.text, /import \{ Choice \} from 'public-api-fixture';/);
    assert.match(choices.text, /import \{ Choice \} from 'public-api-fixture\/alternate';/);
    assert.match(choices.text, /const First: \{ first: true \}/);
    assert.match(choices.text, /const Second: \{ second: true \}/);
    const member = await describeAPI(root, 'Widget.create');
    assert.deepEqual(member.missing, []);
    assert.match(member.text, /create\(options: Options\)/);
    assert.match(member.text, /interface Input/);
    assert.doesNotMatch(member.text, /const Widget|obsoleteHelper|Unrelated/);
    for (const factory of ['plot', 'createPlot']) {
      const interval = await describeAPI(root, `${factory}.interval`);
      assert.deepEqual(interval.missing, []);
      assert.match(interval.text, new RegExp(`import \\{ ${factory} \\}`));
      assert.match(interval.text, /interval\(name: string, options: Options\)/);
      assert.match(interval.text, /at\(from: number, to: number\): void/);
      assert.match(interval.text, /interface Input/);
      assert.doesNotMatch(
        interval.text,
        /declare function (?:create|makePlot)|obsoleteHelper|Unrelated/,
      );
    }
    const factoryProperty = await describeAPI(root, 'plot.version');
    assert.deepEqual(factoryProperty.missing, []);
    assert.match(factoryProperty.text, /version: 'factory'/);
    assert.doesNotMatch(factoryProperty.text, /version: 'instance'/);
    // Both properties share Box.value's declaration; only its callable instantiation
    // belongs in unqualified method discovery. Explicit data-property lookup still works.
    const callable = await describeAPI(root, 'value');
    assert.deepEqual(callable.missing, []);
    assert.match(callable.text, /import \{ CallableBox \}/);
    assert.doesNotMatch(callable.text, /import \{ DataBox \}/);
    const data = await describeAPI(root, 'DataBox.value');
    assert.deepEqual(data.missing, []);
    assert.match(data.text, /import \{ DataBox \}/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
