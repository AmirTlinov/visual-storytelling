import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { renderer } from '../tools/render.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';
import { compileScore } from '../dist/characters/score.js';
import { experiment } from '../examples/press-reaction/experiment.js';

test('physical art shares contact tracks, placement, capture and host values through rewind', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'physical-art-'));
  let capture;
  try {
    const bundle = await build({
      plugins: [assetURLs()],
      stdin: {
        resolveDir: fileURLToPath(new URL('../', import.meta.url)),
        contents: `
          import {CharacterStage,portable,arrange} from '@visual-storytelling/core/characters';
          import {compileScore} from './dist/characters/score.js';
          import {experiment} from './examples/press-reaction/experiment.js';
          import './src/style.css';
          const host=document.querySelector('#scene');
          const options={...experiment,props:{flat:{art:{svg:'<circle r="4"/>'},at:{x:100,y:100},values:{level:0}}},
            beats:experiment.beats.map(b=>b.id==='on'?{...b,props:{...b.props,flat:{...b.props.meter,values:{level:.8}}}}:b)};
          const score=compileScore(options);
          const second={...experiment,set:arrange(experiment.set,{objects:{meter:{art:portable('instrument',{x:0,z:0}).art}}})};
          const cutout={...experiment,background:false,beats:experiment.beats.map(b=>({...b,shot:{focus:['hero']}}))};
          window.galleryReady=CharacterStage.mountMany(host,[options,second,cutout]).then(pool=>{
            const stage=pool.render(0,0);
            window.lab={cues:score.script.cues,on:score.propTracks.meter[0],off:score.propTracks.meter[1],
              sample(time,reduced=false){stage.render(time,reduced);return stage.snapshot();},
              inspect(){const root=host.querySelector('.ve-character-stage:not([hidden]) [data-surface=meter]');return {
                needle:root.querySelector('[data-dial]')?.getAttribute('transform'),
                button:root.querySelector('[data-button]').getAttribute('fill'),
                quad:stage.snapshot().surfaces.meter.quad,
              };},
              explore(time){stage.render(time,false,{time,progress:1,reduced:false,mode:'explore',values:{dial:.25,active:0,label:'show',enabled:true}});return stage.snapshot();},
              canvasErrors(){return [()=>stage.canvas,()=>pool.canvas].map(read=>{try{read();return false;}catch(e){return /[Cc]apture/.test(e.message);}});},
              async capture(){
                const before=stage.snapshot(),image=await stage.capture(),omitted=await stage.capture({omit:['meter','lamp']});
                const pigment=canvas=>{const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0;
                  for(let i=0;i<pixels.length;i+=4)if(pixels[i]===150&&pixels[i+1]===115&&pixels[i+2]===79)count++;return count;};
                return {before,after:stage.snapshot(),image:image.toDataURL(),pigment:pigment(image),omitted:pigment(omitted)};
              },
              other(time){const other=pool.render(1,time);const state=other.snapshot();pool.render(0,time);return state;},
              transparent(time){const cutout=pool.render(2,time);const state=cutout.snapshot();pool.render(0,time);return state;},
              dispose(){pool.dispose();return host.childElementCount;},
            };
          });`,
      },
      bundle: true,
      write: false,
      outdir: '.',
      format: 'iife',
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><head><link rel="stylesheet" href="style.css"></head><body style="margin:0"><div id="scene" style="width:960px;height:650px;position:relative"></div><script src="index.js"></script>',
    );
    for (const output of bundle.outputFiles)
      await writeFile(
        join(directory, output.path.endsWith('.css') ? 'style.css' : 'index.js'),
        output.text,
      );
    capture = await renderer({ directory, width: 960, controls: true });
    const { cues, on, off } = await capture.page.evaluate(() => window.lab);
    const sample = (time, reduced = false) =>
      capture.page.evaluate(({ time, reduced }) => window.lab.sample(time, reduced), {
        time,
        reduced,
      });
    const initial = await sample(on.start - 1e-6);
    assert.deepEqual(initial.props.meter.values, { dial: 0, active: 0 });
    const halfway = await sample((on.start + on.end) / 2);
    assert.ok(Math.abs(halfway.props.meter.values.dial - 0.4) < 1e-10);
    assert.equal(halfway.props.flat.values.level, halfway.props.meter.values.dial);
    assert.equal(halfway.props.meter.values.active, 1);
    const states = [];
    for (const time of [
      on.end,
      cues.take.end,
      (cues.carry.start + cues.carry.end) / 2,
      cues.put.end,
      off.end,
    ]) {
      const state = await sample(time);
      const values = state.props.meter.values;
      assert.equal(values.dial, time < off.end ? 0.8 : 0);
      assert.deepEqual(state.surfaces.meter.content.values, values);
      assert.equal(state.surfaces.meter.visible, true);
      assert.deepEqual(state.framing.clipped, []);
      const quad = state.surfaces.meter.quad,
        box = state.bounds.meter;
      assert.ok(Math.abs(quad[0].x - box.x) < 1e-8);
      assert.ok(Math.abs(quad[0].y - box.y) < 1e-8);
      assert.ok(Math.abs(quad[2].x - box.x - box.width) < 1e-8);
      states.push([time, state]);
    }
    assert.equal(states[1][1].world.items.hero.id, 'meter');
    assert.equal(states[3][1].world.items.hero, undefined);
    assert.notDeepEqual(states[0][1].surfaces.meter.quad, states[2][1].surfaces.meter.quad);
    for (const [time, expected] of states.reverse()) {
      await sample(time, true);
      assert.deepEqual(await sample(time), expected);
    }
    assert.equal((await sample(on.start - 1e-6, true)).props.meter.values.dial, 0);
    assert.equal((await sample(on.start + 1e-6, true)).props.meter.values.dial, 0.8);
    const interactive = await capture.page.evaluate((time) => window.lab.explore(time), on.end);
    assert.equal(interactive.surfaces.meter.content.values.dial, 0.25);
    assert.equal(interactive.surfaces.meter.content.values.active, 1);
    assert.equal(interactive.surfaces.meter.content.values.label, undefined);
    assert.equal(interactive.surfaces.meter.content.values.enabled, undefined);
    const after = await sample(cues.take.end);
    assert.equal(after.surfaces.meter.content.values.dial, 0.8);
    assert.deepEqual(await capture.page.evaluate(() => window.lab.canvasErrors()), [true, true]);
    const image = await capture.page.evaluate(() => window.lab.capture());
    assert.deepEqual(image.after, image.before);
    assert.ok(image.pigment > 100, 'capture contains the physical drawing');
    assert.equal(image.omitted, 0, 'omitting a held object removes its live drawing too');
    const artifacts = fileURLToPath(new URL('../artifacts/physical-art/', import.meta.url));
    await mkdir(artifacts, { recursive: true });
    await writeFile(
      join(artifacts, 'capture.png'),
      Buffer.from(image.image.split(',')[1], 'base64'),
    );
    await capture.page.locator('#scene').screenshot({ path: join(artifacts, 'live.png') });
    const other = await capture.page.evaluate((time) => window.lab.other(time), on.end);
    assert.equal(other.surfaces.meter.content.values.active, 1);
    assert.equal((await capture.page.evaluate(() => window.lab.inspect())).button, '#ead67d');
    for (const [time, visible] of [
      [0, false],
      [cues.take.end, true],
      [cues.put.end, false],
    ]) {
      const cutout = await capture.page.evaluate((time) => window.lab.transparent(time), time);
      assert.equal(
        cutout.surfaces.lamp,
        undefined,
        'resting artwork is absent from a cast-only stage',
      );
      assert.equal(cutout.surfaces.meter.visible, visible, 'carried artwork follows its holder');
    }
    const ids = await capture.page
      .locator('#scene [id]')
      .evaluateAll((nodes) => nodes.map((n) => n.id));
    assert.equal(ids.length, new Set(ids).size, 'pooled artwork and definitions have unique IDs');
    assert.deepEqual(
      capture.messages.filter((message) => message.type === 'error'),
      [],
    );
    assert.equal(await capture.page.evaluate(() => window.lab.dispose()), 0);
  } finally {
    await capture?.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('physical drawings reject competing owners before mounting', () => {
  const change = (props) => ({
    ...experiment,
    beats: [{ id: 'bad', text: 'Probe', seconds: 1, props }],
  });
  assert.throws(
    () => compileScore(change({ meter: { at: { x: 0, y: 0 } } })),
    /physical placement belongs to perform/,
  );
  assert.throws(
    () => compileScore(change({ meter: { values: { active: 1 } } })),
    /press trigger owns the active/,
  );
  assert.throws(
    () =>
      compileScore({ ...experiment, props: { meter: { art: { svg: '' }, at: { x: 0, y: 0 } } } }),
    /shares an actor or prop ID/,
  );
  assert.throws(
    () =>
      compileScore({
        ...experiment,
        surfaces: { meter: { title: 'Conflicting drawing', create() {} } },
      }),
    /art.paint owns its whole drawing/,
  );
});
