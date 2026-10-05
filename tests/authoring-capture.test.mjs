import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import { svgRuntime } from '../tools/svg-runtime.mjs';
const run = promisify(execFile);

test('review honours the viewport and export finds a semantic frame without manual time arithmetic', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'story-author-capture-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const runtime = await svgRuntime({ '': ['mountScene'] });
  await writeFile(
    join(dir, 'index.html'),
    `<!doctype html><html><head><style>
    body{margin:0}.ve-scene{width:100vw;height:50vh;background:rgb(255,0,0)}
    </style></head><body><main class="ve-scene" data-scene-frame></main><script>${runtime}
    VisualStory.mountScene(document.querySelector('main'), {duration:10,pause(){},dispose(){},
      seek(t){document.querySelector('main').style.background=t===5?'rgb(0,255,0)':'rgb(255,0,0)'},
      snapshot(){return {width:innerWidth,height:innerHeight}},
      review(){return {duration:10,segments:[],cues:[{id:'draw',kind:'action',start:4,end:6,action:'Draw',referenced:true}]}}
    });</script></body></html>`,
  );
  const cli = fileURLToPath(new URL('../tools/scene.mjs', import.meta.url));
  const { stdout } = await run(process.execPath, [
    cli,
    'review',
    dir,
    '--width',
    '375',
    '--height',
    '844',
    '--cue',
    'draw',
    '--frames',
    '2',
    '--out',
    join(dir, 'review'),
  ]);
  const receipt = JSON.parse(stdout);
  assert.deepEqual(receipt.source.viewport, { width: 375, height: 844 });
  const manifest = JSON.parse(await readFile(receipt.captureManifest, 'utf8'));
  assert.deepEqual(manifest.frames[0].state, { width: 375, height: 844 });
  const image = join(dir, 'cue.png');
  await run(process.execPath, [
    cli,
    'export',
    dir,
    '--cue',
    'draw',
    '--progress',
    '.5',
    '--width',
    '375',
    '--height',
    '844',
    '--out',
    image,
  ]);
  const png = PNG.sync.read(await readFile(image));
  assert.deepEqual([png.width, png.height], [375, 422]);
  assert.deepEqual([...png.data.subarray(0, 4)], [0, 255, 0, 255]);
});
