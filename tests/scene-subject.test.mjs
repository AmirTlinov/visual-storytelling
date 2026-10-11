import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { serve } from '../tools/site.mjs';
import { renderer } from '../tools/render.mjs';
import { packDirectory, withCheckpoint } from '../tools/standalone.mjs';
import { buildPage } from '../tools/build-pages.mjs';
import { viewReport } from '../plugin/mcp/schema.mjs';

test('subject checkpoints follow completed inputs and atomically supersede failed or pending preparation', async () => {
  const bundled = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
      import {SceneShell} from './dist/scene.js';
      const root=document.querySelector('main');
      const shell=SceneShell.mount(root,{title:'Subject',parameters:[{key:'x',label:'X',value:1,min:0,max:20}]});
      let reject, signal, renders=0;
      const checkpoint={
        encode:input=>({version:1,input}),
        decode(value){
          if(value?.version!==1 || !Array.isArray(value.input?.trace)) throw new Error('Unknown subject schema');
          return structuredClone(value.input);
        },
      };
      const story=shell.attachStory({
        script:{duration:10,cues:{all:{start:0,end:10}}},
        stateAt:frame=>({x:frame.time+1,trace:[{sample:frame.time}]}), checkpoint,
        derive(input,frame){
          if(!Number.isFinite(input.x)||input.x<0)throw new Error('Invalid subject input');
          return {...input,total:input.x+input.trace.reduce((sum,item)=>sum+item.sample,0),time:frame.time};
        },
        prepare(value,frame,mode,pending){
          if(value.x===7){signal=pending;return new Promise((_,no)=>reject=no)}
        },
        render(value){renders++;root.dataset.drawn=value.total;if(value.x===9)throw new Error('Drawing interrupted')},
      });
      window.lab={root,shell,story,checkpoint,reject:()=>reject(new Error('Preparation interrupted')),signal:()=>signal,renders:()=>renders};
    `,
    },
    bundle: true,
    write: false,
    format: 'iife',
    outdir: '.',
    loader: { '.woff2': 'dataurl' },
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent('<main class="ve-scene"></main>');
    await page.addScriptTag({
      content: bundled.outputFiles.find((file) => file.path.endsWith('.js')).text,
    });
    const pending = await page.evaluate(() => {
      lab.story.seek(2);
      lab.story.explore({ x: 4, trace: [{ sample: 42 }] });
      window.saved = lab.root.scene.capture();
      const copy = lab.root.scene.capture();
      copy.subject.input.trace[0].sample = 999;
      lab.story.explore({ x: 7, trace: [{ sample: 165 }] });
      return {
        presented: lab.root.scene.capture(),
        requested: lab.root.scene.capture({ basis: 'requested' }),
        saved,
      };
    });
    assert.deepEqual(pending.presented.subject, {
      version: 1,
      input: { x: 4, trace: [{ sample: 42 }] },
    });
    assert.deepEqual(pending.requested.subject, {
      version: 1,
      input: { x: 7, trace: [{ sample: 165 }] },
    });
    assert.equal(pending.presented.values.x, 4);
    assert.equal(pending.requested.values.x, 7);
    const recovered = await page.evaluate(async () => {
      lab.reject();
      await lab.story.ready().catch(() => {});
      const held = lab.root.scene.capture();
      const before = lab.renders();
      await lab.root.scene.restore(saved);
      const afterFailure = { state: lab.root.scene.snapshot(), rendered: lab.renders() - before };
      lab.story.explore({ x: 7, trace: [{ sample: 800 }] });
      const cancelled = lab.signal();
      await lab.root.scene.restore(saved);
      return { held, afterFailure, aborted: cancelled.aborted, restored: lab.root.scene.capture() };
    });
    assert.deepEqual(recovered.held.subject, pending.presented.subject);
    assert.deepEqual(recovered.afterFailure, {
      state: { x: 4, trace: [{ sample: 42 }], total: 46, time: 2 },
      rendered: 1,
    });
    assert.equal(recovered.aborted, true);
    assert.deepEqual(recovered.restored.subject, pending.presented.subject);
    const invalid = await page.evaluate(async () => {
      const errors = [];
      for (const subject of [
        { version: 2, input: { x: 10, trace: [] } },
        { version: 1, input: { x: -1, trace: [] } },
      ]) {
        try {
          await lab.root.scene.restore({ ...saved, cue: undefined, time: 8, subject });
        } catch (error) {
          errors.push(error.message);
        }
      }
      return { errors, state: lab.root.scene.snapshot(), time: lab.story.currentTime };
    });
    assert.deepEqual(invalid.errors, ['Unknown subject schema', 'Invalid subject input']);
    assert.equal(invalid.time, 2);
    assert.deepEqual(invalid.state, recovered.afterFailure.state);
    const failedRender = await page.evaluate(async () => {
      try {
        lab.story.explore({ x: 9, trace: [] });
      } catch {}
      let failure;
      try {
        lab.root.scene.capture();
      } catch (error) {
        failure = error.code;
      }
      const requested = lab.root.scene.capture({ basis: 'requested' });
      await lab.root.scene.restore(saved);
      return { failure, requested, restored: lab.root.scene.capture() };
    });
    assert.equal(failedRender.failure, 'scene_not_presented');
    assert.equal(failedRender.requested.subject.input.x, 9);
    assert.deepEqual(failedRender.restored.subject, pending.presented.subject);
  } finally {
    await browser.close();
  }
});

test(
  'an arbitrary accepted subject survives seek, offline reload, portable HTML and current PNG',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-subject-portable-'));
    let browser, server, exported, output;
    try {
      const source = join(directory, 'source');
      await buildPage(resolve('tests/fixtures/scene-shell/subject.html'), source, {
        outputName: 'index.html',
      });
      server = await serve(source);
      browser = await chromium.launch(chromiumLaunchOptions());
      const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(server.url);
      await page.evaluate(() => window.galleryReady);
      await page.evaluate(() => {
        const scene = document.querySelector('.ve-scene').scene;
        scene.seek(2);
        scene.explore({ x: 4, trace: [{ sample: 42 }, { sample: -2 }] });
      });
      const before = await page.evaluate(() => {
        const scene = document.querySelector('.ve-scene').scene;
        return { state: scene.snapshot(), checkpoint: scene.capture() };
      });
      assert.equal(before.state.total, 44);
      assert.deepEqual(before.checkpoint.subject.input.trace, [{ sample: 42 }, { sample: -2 }]);
      assert.deepEqual(
        viewReport.parse({ stateRevision: 1, state: {}, checkpoint: before.checkpoint }).checkpoint
          .subject,
        before.checkpoint.subject,
      );
      await page.evaluate(async (checkpoint) => {
        const scene = document.querySelector('.ve-scene').scene;
        scene.seek(0);
        await scene.restore(checkpoint);
      }, before.checkpoint);
      assert.deepEqual(
        await page.evaluate(() => document.querySelector('.ve-scene').scene.snapshot()),
        before.state,
      );
      await page.reload();
      await page.evaluate(() => window.galleryReady);
      assert.deepEqual(
        await page.evaluate(() => document.querySelector('.ve-scene').scene.snapshot()),
        before.state,
      );
      const packed = withCheckpoint(
        await packDirectory(source, 'index.html', { audio: 'original' }),
        before.checkpoint,
      );
      await writeFile(join(directory, 'index.html'), packed);
      exported = await serve(directory);
      const context = await browser.newContext({ viewport: { width: 960, height: 1000 } });
      const artifact = await context.newPage();
      artifact.on('pageerror', (error) => errors.push(error.message));
      await artifact.goto(exported.url);
      await artifact.evaluate(() => window.galleryReady);
      assert.deepEqual(
        await artifact.evaluate(() => document.querySelector('.ve-scene').scene.snapshot()),
        before.state,
      );
      assert.match(await artifact.locator('.ve-stage output').textContent(), /4 \+ 42 \+ -2 = 44/);
      output = await renderer({
        directory: source,
        width: 390,
        height: 1000,
        reduced: true,
        checkpoint: before.checkpoint,
      });
      assert.deepEqual(await output.capture.evaluate((scene) => scene.snapshot()), before.state);
      assert.deepEqual([...(await output.png()).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.deepEqual(errors, []);
    } finally {
      await output?.close();
      await browser?.close();
      await server?.close();
      await exported?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
