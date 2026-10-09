import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { serve } from '../tools/site.mjs';
import { openScene, seekScene } from '../tools/open-scene.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('one scene boundary preserves capabilities, live time and model ownership through UI and capture', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-boundary-'));
  let browser, server;
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import {SceneShell, mountScene, SmilPlayer} from './dist/index.js';
          import './dist/style.css';
          window.galleryReady = (async () => {
            await SceneShell.ready();
            const root = document.querySelector('main');
            const parameter = {key:'x',label:'Value',value:3,min:0,max:15,step:1};
            const shell = SceneShell.mount(root,{title:'Ownership',parameters:[parameter]});
            const registered = root.scene;
            const before = registered.inspect();
            let modelInputs=0, badNarration=false, nativeSeeks=0;
            const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
            svg.setCurrentTime=()=>nativeSeeks++;
            shell.stage.append(svg);
            const story=shell.attachStory({script:{duration:10,cues:{work:{start:0,end:10,action:'A visible task'}}},
              stateAt:()=>{if(badNarration)throw Error('Invalid narrative state');return {x:3};},
              derive:v=>{if(v.x===13)throw Error('Model rejects thirteen');return v;},
              render:v=>svg.dataset.value=v.x});
            const editable = document.querySelector('section');
            const modelShell = SceneShell.mount(editable,{title:'Model',parameters:[parameter],
              onInput:v=>{if(v.x===13)throw Error('Rejected model input');modelInputs++;editable.dataset.value=v.x;}});
            const native = document.querySelector('aside');
            class Runtime {
              #time=0; playing=false; duration=8; focusEnabled=true;
              get currentTime(){return this.#time;}
              seek(next){this.#time=next;}
              play(){this.playing=true;}
              pause(){this.playing=false;}
              snapshot(){return {time:this.#time};}
              get focus(){return this.focusEnabled ? this.focusOn : undefined;}
              focusOn(ids){this.focused=ids;}
              dispose(){}
            }
            const subject=new Runtime();
            const runtime=mountScene(native,subject);
            window.lab={root,shell,story,registered,before,editable,modelShell,runtime,parameter,
              subject, SmilPlayer,
              badNarration:value=>badNarration=value,
              facts:()=>({modelInputs,nativeSeeks,value:svg.dataset.value})};
          })();`,
      },
      bundle: true,
      loader: { '.woff2': 'dataurl' },
      format: 'iife',
      outfile: join(directory, 'index.js'),
      plugins: [assetURLs()],
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><head><link rel="stylesheet" href="index.css"></head><body><main class="ve-scene"></main><section class="ve-scene"></section><aside></aside><script src="index.js"></script></body></html>',
    );
    server = await serve(directory);
    browser = await chromium.launch();
    const page = await browser.newPage();
    const capture = await openScene(page, server.url);
    const initial = await page.evaluate(() => ({
      same: lab.root.scene === lab.registered,
      before: lab.before.capabilities,
      after: lab.root.scene.inspect().capabilities,
      model: lab.editable.scene.inspect().capabilities,
    }));
    assert(initial.same, 'attaching a story must keep the registered handle');
    assert.deepEqual(initial.before, ['parameters', 'theme', 'undoExperiment', 'redoExperiment']);
    assert.deepEqual(initial.model, ['parameters', 'theme', 'undoExperiment', 'redoExperiment']);
    assert(initial.after.includes('seek') && initial.after.includes('cue'));
    await seekScene(capture, 4.5);
    assert.equal(await page.evaluate(() => lab.root.scene.currentTime), 4.5);
    assert.equal(
      await page.evaluate(() => lab.facts().nativeSeeks),
      0,
      'capture must not also drive the SVG clock',
    );
    const runtime = await page.evaluate(async () => {
      await lab.runtime.control([{ type: 'seek', time: 6 }, { type: 'play' }]);
      return lab.runtime.inspect();
    });
    assert.equal(runtime.time, 6);
    assert(runtime.playing);
    assert.deepEqual(runtime.snapshot, { time: 6 });
    assert.equal(await page.evaluate(() => lab.subject.currentTime), 6);
    await page.evaluate(() => {
      lab.subject.focusEnabled = false;
      lab.editable.scene.duration = 5;
    });
    assert.equal(
      await page.evaluate(() => lab.runtime.inspect().capabilities.includes('focus')),
      false,
    );
    await assert.rejects(
      page.evaluate(() => lab.runtime.control([{ type: 'focus', ids: ['item'] }])),
      /unavailable/,
    );
    assert.equal(await page.evaluate(() => lab.editable.scene.review().duration), 5);
    await page.evaluate(() =>
      lab.editable.scene.control([{ type: 'parameters', values: { x: 7 } }]),
    );
    assert.equal(await page.locator('section').getAttribute('data-value'), '7');
    assert.equal(await page.evaluate(() => lab.facts().modelInputs), 1);
    await assert.rejects(
      page.evaluate(() => lab.editable.scene.control([{ type: 'parameters', values: { x: 13 } }])),
      /Rejected model input/,
    );
    assert.equal(await page.locator('section input').inputValue(), '7');
    assert.equal(await page.evaluate(() => lab.editable.scene.inspect().parameters[0].value), 7);
    await assert.rejects(
      page.evaluate(() => lab.editable.scene.control([{ type: 'seek', time: 1 }])),
      /outside story time|unavailable/,
    );
    await page.locator('main [data-mode=explore]').click();
    const input = page.locator('main').getByRole('slider', { name: 'Value', exact: true });
    await input.fill('13');
    assert.equal(await input.inputValue(), '3', 'a rejected field must agree with the model');
    assert.equal(await page.evaluate(() => lab.story.requested.values.x), 3);
    await page.evaluate(() => lab.badNarration(true));
    await assert.rejects(
      page.evaluate(() => lab.root.scene.control([{ type: 'mode', value: 'story' }])),
      /Invalid narrative/,
    );
    assert.equal(await page.evaluate(() => lab.root.scene.inspect().mode), 'explore');
    assert.equal(
      await page.locator('main [data-mode=explore]').getAttribute('aria-pressed'),
      'true',
    );
    await page.evaluate(() => {
      lab.badNarration(false);
      lab.shell.describeParameter('x', { label: 'Locked value', disabled: true });
    });
    const description = await page.evaluate(() => lab.root.scene.inspect().parameters[0]);
    assert.equal(description.label, 'Locked value');
    assert(description.disabled);
    assert.equal(
      await page.evaluate(() => lab.parameter.label),
      'Value',
      'descriptions cannot mutate a shared author definition',
    );
    await assert.rejects(
      page.evaluate(() => lab.root.scene.control([{ type: 'parameters', values: { x: 8 } }])),
      /Invalid scene parameter: x/,
    );
    assert.equal(await page.evaluate(() => lab.story.requested.values.x), 3);
    assert.equal(await page.getByRole('slider', { name: 'Locked value' }).inputValue(), '3');
    await assert.rejects(
      page.evaluate(() => lab.shell.syncParameters({ x: 8 })),
      /story.input/,
    );
    const failures = await page.evaluate(async () => {
      const result = [];
      for (const event of ['error', 'load', 'dispose']) {
        const host = document.createElement('div');
        host.innerHTML = '<object></object><div data-player></div>';
        document.body.append(host);
        const player = lab.SmilPlayer.mount(host, { duration: 4 });
        if (host.scene !== player.scene || host.querySelectorAll('[data-scene-frame]').length !== 1)
          throw new Error('SVG playback and its complete frame must have one scene owner');
        const ready = player.ready.then(
          () => null,
          (error) => error.message,
        );
        if (event === 'dispose') player.dispose();
        else host.querySelector('object').dispatchEvent(new Event(event));
        result.push(await ready);
        player.dispose();
        if (host.scene || host.querySelector('[data-scene-frame]'))
          throw new Error('SVG disposal must release its scene and frame');
        host.remove();
      }
      return result;
    });
    assert(failures.every(Boolean), 'SVG readiness must reject failed load and early disposal');
    await page.evaluate(() => {
      lab.root.scene.dispose();
    });
    assert.equal(await page.evaluate(() => lab.root.scene), undefined);
    await assert.rejects(
      page.evaluate(() => lab.registered.control([{ type: 'seek', time: 1 }])),
      /disposed/,
    );
    await assert.rejects(
      page.evaluate(() => lab.story.seek(1)),
      /disposed/,
    );
  } finally {
    await browser?.close();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
