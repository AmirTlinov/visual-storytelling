import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { sceneGenerator } from '../tools/generate-scene.mjs';

const examples = ['logic-gates', 'lc-oscillator', 'parameter-cube', 'geometric-tensor'];
const root = new URL('../', import.meta.url).pathname;

test('all Python-backed catalog generators declare their actual preparation need', async () => {
  for (const id of examples)
    assert.equal((await sceneGenerator(join(root, 'examples', id))).python, true, id);
  assert.equal(await sceneGenerator(join(root, 'examples/explorer-svg')), undefined);
});

test(
  'a fresh managed environment generates every SVG form without system Python, uv or voice models',
  { timeout: 240000, skip: process.platform !== 'darwin' || process.arch !== 'arm64' },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-generators-'));
    try {
      const emptyPath = join(directory, 'empty-path');
      await mkdir(emptyPath);
      const env = { ...process.env, PATH: emptyPath, MPLCONFIGDIR: join(directory, 'matplotlib') };
      for (const key of Object.keys(env))
        if (key.startsWith('VISUAL_STORY_') || key.startsWith('UV_')) delete env[key];
      const code = String.raw`
import assert from 'node:assert/strict';
import {readFile,readdir,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {prepareEnvironment} from ${JSON.stringify(new URL('../plugin/environment.mjs', import.meta.url).href)};
import {generateScene} from ${JSON.stringify(new URL('../tools/generate-scene.mjs', import.meta.url).href)};
const data=process.argv[1];
await prepareEnvironment(data,{python:true,signal:new AbortController().signal,progress(){}});
assert.ok(process.env.VISUAL_STORY_PYTHON.startsWith(await realpath(join(data,'environment/python'))+'/'));
assert.ok(process.env.VISUAL_STORY_UV.startsWith(join(data,'environment')+'/'));
for(const [id,file] of [
  ['logic-gates','logic-gates.svg'],['lc-oscillator','LC-oscillator.svg'],
  ['parameter-cube','tensor-cube.svg'],['geometric-tensor','geometric-tensor.svg']
]){
  const output=join(data,'generated',id);
  await generateScene(join(${JSON.stringify(root)},'examples',id),output);
  const svg=await readFile(join(output,file),'utf8');
  assert.match(svg,/<svg\b/);
  assert.match(svg,/id="ve-shared-ink"/);
}
assert.ok(!(await readdir(join(data,'environment'))).some(name=>name.startsWith('higgs-')));
`;
      await promisify(execFile)(process.execPath, ['--input-type=module', '-e', code, directory], {
        env,
        maxBuffer: 4_000_000,
        timeout: 230000,
      });
      assert.deepEqual((await readdir(join(directory, 'generated'))).sort(), [...examples].sort());
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
