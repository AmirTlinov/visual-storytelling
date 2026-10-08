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
  const browser = await chromium.launch();
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
  'the register prediction survives seek, widget reload, current HTML and current PNG',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-subject-'));
    const server = await serve('site');
    let browser, exported, output;
    try {
      browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 960, height: 1200 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(server.url + '/memory-register/index.html');
      await page.evaluate(() => window.galleryReady);
      await page.locator('[data-mode="explore"]').click();
      await page.locator('#challenge-start').click();
      await page.locator('#prediction').getByRole('button', { name: '42', exact: true }).click();
      await page.getByRole('button', { name: 'Проверить фронтом ↑' }).click();
      const before = await page.evaluate(() => ({
        state: document.querySelector('.ve-scene').scene.snapshot(),
        checkpoint: document.querySelector('.ve-scene').scene.capture(),
      }));
      assert.equal(before.state.input, 165);
      assert.equal(before.state.saved, 42);
      assert.equal(before.state.checked, true);
      assert.equal(before.state.guess, 42);
      assert.deepEqual(before.state.trace, [
        { input: 165, saved: 42, we: false, edge: '↑', write: false },
      ]);
      const accepted = viewReport.parse({
        stateRevision: 1,
        state: {},
        checkpoint: before.checkpoint,
      });
      assert.deepEqual(
        accepted.checkpoint.subject,
        before.checkpoint.subject,
        'the MCP report preserves the subject',
      );
      const restored = await page.evaluate(async (checkpoint) => {
        const scene = document.querySelector('.ve-scene').scene;
        await scene.control([{ type: 'seek', time: 0 }]);
        const reset = scene.snapshot();
        await scene.restore(checkpoint);
        return { reset, state: scene.snapshot() };
      }, before.checkpoint);
      assert.equal(restored.reset.saved, 0);
      assert.deepEqual(restored.state, before.state);
      await page.reload();
      await page.evaluate(() => window.galleryReady);
      assert.deepEqual(
        await page.evaluate(() => document.querySelector('.ve-scene').scene.snapshot()),
        before.state,
        'widget persistence uses the same checkpoint owner',
      );
      const html = withCheckpoint(
        await packDirectory(resolve('site/memory-register'), 'index.html', { audio: 'original' }),
        before.checkpoint,
      );
      await writeFile(join(directory, 'index.html'), html);
      exported = await serve(directory);
      const fresh = await browser.newContext({ viewport: { width: 960, height: 1200 } });
      const artifact = await fresh.newPage();
      artifact.on('pageerror', (error) => errors.push(error.message));
      await artifact.goto(exported.url);
      await artifact.evaluate(() => window.galleryReady);
      assert.deepEqual(
        await artifact.evaluate(() => document.querySelector('.ve-scene').scene.snapshot()),
        before.state,
        'standalone HTML restores in a context with no widget storage',
      );
      assert.match(
        await artifact.locator('.ve-prediction [role=status]').textContent(),
        /Верно.*Получилось 42/,
      );
      output = await renderer({
        scene: 'memory-register',
        theme: 'light',
        width: 960,
        height: 1200,
        reduced: true,
        checkpoint: before.checkpoint,
      });
      assert.deepEqual(
        await output.capture.evaluate((scene) => scene.snapshot()),
        before.state,
        'the PNG renderer restores the same subject',
      );
      const png = await output.png();
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      if (process.env.VISUAL_STORY_CHECKPOINT_PNG)
        await writeFile(process.env.VISUAL_STORY_CHECKPOINT_PNG, png);
      assert.deepEqual(errors, []);
    } finally {
      await output?.close();
      await browser?.close();
      await exported?.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'register details and clock history retain their visible panel through reload and current HTML',
  { timeout: 60000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-register-panels-'));
    const server = await serve('site');
    const exported = await serve(directory);
    const browser = await chromium.launch();
    let current, fixed;
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 1000 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(server.url + '/memory-register/index.html');
      await page.evaluate(() => window.galleryReady);
      await page.evaluate(() => document.querySelector('.ve-scene').scene.seek(34));
      const cell = page.locator('[data-select="7"]');
      await cell.focus();
      await cell.press('Enter');
      assert.equal(
        await page.evaluate(() => document.activeElement.id),
        'inside',
        'opening a detail from narrated mode first reveals and then focuses its panel',
      );
      const html = await packDirectory(resolve('site/memory-register'), 'index.html', {
        audio: 'original',
      });
      for (const panel of ['inside', 'trace-panel']) {
        if (panel === 'trace-panel') {
          await page.keyboard.press('Escape');
          assert.equal(await cell.evaluate((element) => element === document.activeElement), true);
          await page.locator('#clock').click();
          await page.locator('#clock').click();
          await page.locator('[data-panel="trace-panel"]').click();
        }
        const before = await page.evaluate(() => ({
          state: document.querySelector('.ve-scene').scene.snapshot(),
          checkpoint: document.querySelector('.ve-scene').scene.capture(),
        }));
        assert.equal(before.state.panel, panel);
        assert.equal(before.state.selected, 7);
        assert.equal(before.checkpoint.subject.state.panel, panel);
        if (panel === 'trace-panel') {
          assert.equal(before.state.saved, 165);
          assert.equal(before.state.trace.at(-1).write, true);
        }
        await page.evaluate(async (checkpoint) => {
          const scene = document.querySelector('.ve-scene').scene;
          await scene.control([{ type: 'seek', time: 0 }]);
          await scene.restore(checkpoint);
        }, before.checkpoint);
        assert.deepEqual(
          await page.evaluate(() => document.querySelector('.ve-scene').scene.snapshot()),
          before.state,
          panel + ' capture restores after seeking away',
        );
        assert.equal(await page.locator('#' + panel).isVisible(), true);
        await page.reload();
        await page.evaluate(() => window.galleryReady);
        assert.deepEqual(
          await page.evaluate(() => document.querySelector('.ve-scene').scene.snapshot()),
          before.state,
          panel + ' widget reload uses the captured subject',
        );
        assert.equal(await page.locator('#' + panel).isVisible(), true);
        assert.equal(await page.evaluate(() => document.activeElement.id), panel);
        assert.equal(
          await page.locator('.memory-drawing').evaluate((element) => element.inert),
          true,
        );
        await writeFile(join(directory, panel + '.html'), withCheckpoint(html, before.checkpoint));
        const context = await browser.newContext({ viewport: { width: 960, height: 1000 } });
        const artifact = await context.newPage();
        artifact.on('pageerror', (error) => errors.push(error.message));
        await artifact.goto(exported.url + '/' + panel + '.html');
        await artifact.evaluate(() => window.galleryReady);
        assert.deepEqual(
          await artifact.evaluate(() => document.querySelector('.ve-scene').scene.snapshot()),
          before.state,
          panel + ' current HTML restores without widget storage',
        );
        assert.equal(await artifact.locator('#' + panel).isVisible(), true);
        if (panel === 'inside')
          assert.match(
            await artifact.locator('#detail-bit').innerText(),
            /Бит 7.*вход D = 1.*Q = 0/,
          );
        else assert.equal(await artifact.locator('#trace tr').count(), before.state.trace.length);
        await artifact.keyboard.press('Escape');
        const opener = panel === 'inside' ? '[data-select="7"]' : '[data-panel="trace-panel"]';
        assert.equal(
          await artifact.locator(opener).evaluate((element) => element === document.activeElement),
          true,
          'restored detail returns keyboard focus to a visible subject control',
        );
        await context.close();
      }
      await page.setViewportSize({ width: 375, height: 1000 });
      await page.waitForFunction(
        () => document.querySelector('[data-scene-frame]').dataset.frameLayout === 'responsive',
      );
      const checkpoint = await page.evaluate(() =>
        document.querySelector('.ve-scene').scene.capture(),
      );
      current = await renderer({ scene: 'memory-register', width: 375, height: 1000, checkpoint });
      assert.equal(
        await current.page.locator('[data-scene-frame]').getAttribute('data-frame-layout'),
        'responsive',
        'current PNG retains the captured narrow layout',
      );
      assert.deepEqual(
        await current.page.evaluate(
          () => document.querySelector('.ve-scene').scene.capture().subject,
        ),
        checkpoint.subject,
      );
      assert.deepEqual(
        [...(await current.png()).subarray(0, 8)],
        [137, 80, 78, 71, 13, 10, 26, 10],
      );
      fixed = await renderer({ scene: 'memory-register', width: 480, height: 300 });
      const frame = await fixed.page.locator('[data-scene-frame]').evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { layout: element.dataset.frameLayout, ratio: bounds.width / bounds.height };
      });
      assert.equal(frame.layout, 'fixed', 'authored export opts back into the original film frame');
      assert.ok(Math.abs(frame.ratio - 16 / 9) < 0.001);
      assert.deepEqual([...(await fixed.png()).subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      assert.deepEqual(errors, []);
    } finally {
      await current?.close();
      await fixed?.close();
      await browser.close();
      await exported.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test(
  'flat controls and manual experiment owners restore the same displayed conditions',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'story-subject-examples-'));
    const server = await serve('site');
    const exported = await serve(directory);
    const browser = await chromium.launch();
    try {
      for (const name of [
        'explorer-svg',
        'threshold-neuron',
        'fraction-of-a-set',
        'equation-balance',
      ]) {
        const context = await browser.newContext({ viewport: { width: 960, height: 1200 } });
        const page = await context.newPage();
        await page.goto(server.url + '/' + name + '/index.html');
        await page.evaluate(() => window.galleryReady);
        if (name === 'explorer-svg')
          await page.evaluate(() =>
            document
              .querySelector('.ve-scene')
              .scene.control([{ type: 'parameters', values: { x: -2, y: 1 } }]),
          );
        if (name === 'threshold-neuron') {
          await page.locator('[data-a]').fill('4');
          await page.locator('[data-mode="formulas"]').click();
        }
        if (name === 'fraction-of-a-set') await page.locator('[data-parts="6"]').click();
        if (name === 'equation-balance') await page.locator('[data-next]').click();
        const before = await page.evaluate(() => {
          const scene = document.querySelector('.ve-scene').scene;
          return { state: scene.snapshot(), checkpoint: scene.capture() };
        });
        if (name === 'explorer-svg') {
          assert.equal(before.checkpoint.subject, undefined);
          assert.deepEqual(before.checkpoint.values, { x: -2, y: 1 });
        } else {
          assert(before.checkpoint.subject, name + ' must include its model');
          assert.equal(
            before.state.progress === undefined
              ? (before.state.settled ?? before.state.complete)
              : before.state.progress === 1,
            false,
            name + ' is captured during its visible motion',
          );
        }
        await page.evaluate(async (checkpoint) => {
          const scene = document.querySelector('.ve-scene').scene;
          if (checkpoint.subject) {
            const altered = structuredClone(checkpoint);
            if (altered.subject.example === 'neuron') altered.subject.a = 0;
            if (altered.subject.example === 'fraction') altered.subject.taken = 0;
            if (altered.subject.example === 'balance') altered.subject.step = 0;
            await scene.restore(altered);
          } else await scene.control([{ type: 'parameters', values: { x: 3, y: 3 } }]);
          await scene.restore(checkpoint);
        }, before.checkpoint);
        assert.deepEqual(
          await page.evaluate(() => document.querySelector('.ve-scene').scene.snapshot()),
          before.state,
          name + ' round trip preserves model and current motion',
        );
        const html = withCheckpoint(
          await packDirectory(resolve('site', name), 'index.html', { audio: 'original' }),
          before.checkpoint,
        );
        await writeFile(join(directory, name + '.html'), html);
        const fresh = await browser.newContext({ viewport: { width: 960, height: 1200 } });
        const artifact = await fresh.newPage();
        await artifact.goto(exported.url + '/' + name + '.html');
        await artifact.evaluate(() => window.galleryReady);
        assert.deepEqual(
          await artifact.evaluate(() => document.querySelector('.ve-scene').scene.snapshot()),
          before.state,
          name + ' standalone restores the same frame without widget storage',
        );
        await fresh.close();
        await context.close();
      }
    } finally {
      await browser.close();
      await exported.close();
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
