import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderer } from '../tools/render.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('camera follows ground travel without footfall zoom or vertical shake, including rewind and resize', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'character-tracking-'));
  let capture;
  try {
    const bundle = await build({
      plugins: [assetURLs()],
      stdin: {
        resolveDir: fileURLToPath(new URL('../', import.meta.url)),
        contents: `
          import {CharacterStage} from './src/characters/stage.ts';
          import {chibi} from './src/characters/packs/chibi.ts';
          import {street,readingRoom} from './src/characters/staging/sets.ts';
          import {arrange} from './src/characters/staging/layout.ts';
          import {portable} from './src/characters/staging/portable.ts';
          import {compileScore} from './src/characters/score.ts';
          import {pressTime} from './src/characters/staging/press.ts';
          import './src/style.css';
          const host=document.querySelector('#scene'),shot={focus:['hero'],framing:'medium'};
          const started=performance.now();
          window.galleryReady=CharacterStage.mount(host,{
            pack:chibi,set:arrange(street(),{objects:{bench:null}}),camera:'responsive',
            cast:{hero:{skin:'tesla',at:{x:-3.3,z:1},scale:.77}},
            beats:[
              {id:'walk',text:'Walk',seconds:4,shot,perform:[{action:'walk',actor:'hero',to:{x:0,z:1}}]},
              {id:'run',text:'Run',seconds:2,shot,perform:[{action:'run',actor:'hero',to:{x:3,z:1}}]},
              {id:'wait',text:'Wait',seconds:2,shot},
              {id:'return',text:'Return',seconds:4,shot,perform:[{action:'walk',actor:'hero',to:{x:-3.3,z:1}}]},
            ],
          }).then(stage=>{window.lab={
            mountMs:performance.now()-started,
            sample(time,reduced=false){stage.render(time,reduced);return stage.snapshot();},
            sequence(times){const start=performance.now();const states=times.map(time=>this.sample(time));return {states,ms:performance.now()-start};},
            resize(w,h){host.style.width=w+'px';host.style.height=h+'px';},
            async press(){
              stage.dispose();
              const room=readingRoom(),options={
                pack:chibi,camera:'responsive',
                set:{...room,staging:{...room.staging,spots:{},layout:undefined,
                  objects:{switch:portable('instrument',{x:0,z:2,height:1.1})}}},
                cast:{hero:{skin:'tesla',at:{x:-4,z:1},scale:.77}},
                script:{duration:60,cues:{press:{start:0,end:60}}},
                beats:[{id:'press',text:'Press',shot:{focus:['hero.hand-right'],framing:'detail'},
                  perform:[{action:'press',actor:'hero',target:'switch'}]}],
              };
              const score=compileScore(options);
              stage=await CharacterStage.mount(host,options);
              return pressTime(score.blocking.plans[0]);
            },
            dispose(){stage.dispose();return host.childElementCount;}
          };});`,
      },
      bundle: true,
      write: false,
      outdir: '.',
      format: 'iife',
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><head><link rel="stylesheet" href="style.css"></head><body style="margin:0"><div id="scene" style="position:relative;width:960px;height:650px"></div><script src="index.js"></script>',
    );
    for (const output of bundle.outputFiles)
      await writeFile(
        join(directory, output.path.endsWith('.css') ? 'style.css' : 'index.js'),
        output.text,
      );
    capture = await renderer({ directory, width: 960, height: 720, controls: true });
    const times = Array.from({ length: 241 }, (_, i) => i / 20);
    const { states, ms } = await capture.page.evaluate(
      (times) => window.lab.sequence(times),
      times,
    );
    const range = (values) => Math.max(...values) - Math.min(...values);
    assert(range(states.map((s) => s.bounds.hero.height)) > 3, 'the gait itself still moves');
    assert(range(states.map((s) => s.camera.x)) > 30, 'the camera follows the actual route');
    for (const field of ['y', 'width', 'height'])
      assert(range(states.map((s) => s.camera[field])) < 1e-8, `footfalls shake camera.${field}`);
    for (const state of states) assert.deepEqual(state.framing.clipped, []);
    for (let i = 1; i <= 120; i++)
      assert(
        states[i].camera.x >= states[i - 1].camera.x - 1e-8,
        'forward travel cannot reverse camera pan',
      );
    for (let i = 161; i < states.length; i++)
      assert(states[i].camera.x <= states[i - 1].camera.x + 1e-8, 'return pan cannot oscillate');
    for (const i of [240, 70, 1, 139, 35]) {
      const rewound = await capture.page.evaluate((time) => window.lab.sample(time), times[i]);
      assert.deepEqual(rewound, states[i]);
    }
    const reduced = await capture.page.evaluate(() => window.lab.sample(2, true));
    assert.deepEqual(reduced.framing.clipped, []);
    await capture.page.evaluate(() => window.lab.resize(360, 760));
    await capture.page.waitForFunction(
      () => document.querySelector('.ve-character-aperture').clientWidth === 360,
    );
    const portrait = await capture.page.evaluate(() => window.lab.sequence([1.2, 1.3, 1.4, 1.5]));
    assert(range(portrait.states.map((s) => s.camera.height)) < 1e-8);
    for (const state of portrait.states) assert.deepEqual(state.framing.clipped, []);
    const artifacts = fileURLToPath(new URL('../artifacts/camera-tracking/', import.meta.url));
    await mkdir(artifacts, { recursive: true });
    await capture.page.locator('#scene').screenshot({ path: join(artifacts, 'portrait.png') });
    await writeFile(
      join(artifacts, 'metrics.json'),
      JSON.stringify(
        {
          frames: states.length,
          renderMs: ms,
          msPerFrame: ms / states.length,
          mountMs: await capture.page.evaluate(() => window.lab.mountMs),
          cameraVerticalRange: range(states.map((s) => s.camera.y)),
          cameraHeightRange: range(states.map((s) => s.camera.height)),
          actorHeightRange: range(states.map((s) => s.bounds.hero.height)),
        },
        null,
        2,
      ),
    );
    // A short natural gesture can fall entirely between samples of a long spoken cue.
    const contact = await capture.page.evaluate(() => window.lab.press());
    const touching = await capture.page.evaluate((t) => window.lab.sample(t), contact);
    assert.deepEqual(
      touching.framing.clipped,
      [],
      'the portrait detail must contain the actual pressing hand',
    );
    for (const time of [contact - 0.15, contact + 0.15, 60, 0, contact]) {
      const state = await capture.page.evaluate((t) => window.lab.sample(t), time);
      assert.deepEqual(state.framing.clipped, []);
      if (time === contact) assert.deepEqual(state, touching, 'gesture framing survives rewind');
    }
    assert.deepEqual(
      capture.messages.filter((m) => m.type === 'error'),
      [],
    );
    assert.equal(await capture.page.evaluate(() => window.lab.dispose()), 0);
  } finally {
    await capture?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
