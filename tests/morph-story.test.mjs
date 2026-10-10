import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { cueSheet } from '../dist/story/cues.js';
import { exploredMorphTime } from '../dist/morph/story.js';
import { morphTiming } from '../dist/morph/timing.js';

test('manual morph time retains authored duration, stage pauses and forced reduced motion', () => {
  const sheet = cueSheet({
    duration: 12,
    cues: { a: { start: 1, end: 3 }, b: { start: 6, end: 10 } },
  });
  for (const cues of [['a'], ['a', 'b'], ['a', 'a', 'b']]) {
    for (const progress of [0, 0.1, 0.5, 0.7, 0.99, 1]) {
      const frame = exploredMorphTime(sheet.at(0, true), cues, progress);
      const time = morphTiming(frame, cues, cues.length);
      assert.ok(Math.abs(time.progress - progress) < 1e-9);
      assert.equal(time.reduced, true);
      assert.ok(
        time.duration > 0,
        'exploration must not revert to an unrelated default physics duration',
      );
    }
  }
  assert.equal(
    morphTiming(exploredMorphTime(sheet.at(0), ['a', 'b'], 0.75), ['a', 'b'], 2).duration,
    8,
  );
  assert.throws(() => morphTiming({ progress: 0.5, duration: -1 }), /duration/);
  assert.throws(() => morphTiming({ progress: NaN }), /progress/);
});

test(
  'public morph authoring reuses operations, validates edited text and disposes the original owners',
  { timeout: 120_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'morph-authoring-'));
    let browser;
    try {
      await build({
        stdin: {
          resolveDir: process.cwd(),
          contents: `
        import { MorphStory, MathMorph, InkMorph } from '@visual-storytelling/core';
        import '@visual-storytelling/core/style.css';
        const prepared = {first:0, second:0};
        const script = {duration:8, cues:{first:{start:0,end:3}, second:{start:4,end:7}}};
        window.galleryReady = (async () => {
          const math = await MorphStory.mount(document.querySelector('#math'), {
            title:'Число и форма', presenter:MathMorph, initial:{amount:6}, script,
            parameters:[{key:'amount',label:'Количество',min:3,max:12,step:1}],
            chapters:[
              {id:'first',title:'Сложение',descriptions:{amount:{disabled:true}},operation:p=>{prepared.first++; return MathMorph.add(p.amount,2);}},
              {id:'second',title:'Деление',operation:p=>{prepared.second++; return MathMorph.divide(p.amount,3);}},
            ],
          });
          const ink = await MorphStory.mount(document.querySelector('#ink'), {
            title:'Смысл в штрихах', presenter:InkMorph, initial:{word:'Свет'},
            parameters:[{key:'word',label:'Слово',type:'text'}],
            script:{duration:4,cues:{word:{start:0,end:4}}},
            chapters:[{id:'word',operation:p=>({sources:[p.word,'Тень'],targets:['Объём']})}],
          });
          async function cleanupTrial(broken) {
            const root=document.createElement('main'); root.className='ve-scene'; document.body.append(root);
            const calls={presentation:0,view:0};
            const view={identity:'custom',reset(){},capture(){return {identity:this.identity}},dispose(){calls.view++}};
            const presenter={mount(){return {view,setOperation(){},render(){if(broken)throw new Error('Broken presenter')},dispose(){calls.presentation++;view.dispose()}}}};
            let capture, failure;
            try {
              const trial=await MorphStory.mount(root,{title:'Cleanup',presenter,initial:{x:1},script:{duration:1,cues:{one:{start:0,end:1}}},chapters:[{id:'one',operation:p=>p.x}]});
              capture=root.scene.capture().view;
              trial.dispose();trial.dispose();
            } catch(error) {failure=error.message}
            root.remove();
            return {calls,capture,failure};
          }
          window.lab = {math, ink, prepared, cleanup:[await cleanupTrial(false),await cleanupTrial(true)]};
        })();`,
        },
        bundle: true,
        format: 'iife',
        tsconfigRaw: { compilerOptions: {} },
        outfile: join(directory, 'index.js'),
        loader: { '.woff2': 'dataurl' },
      });
      await writeFile(
        join(directory, 'index.html'),
        '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="index.css"></head><body class="ve-standalone"><main id="math" class="ve-scene"></main><main id="ink" class="ve-scene"></main><script src="index.js"></script></body></html>',
      );
      browser = await chromium.launch();
      const page = await browser.newPage({ viewport: { width: 800, height: 900 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(pathToFileURL(join(directory, 'index.html')).href);
      await page.evaluate(() => window.galleryReady);
      const initial = await page.evaluate(() => ({
        prepared: lab.prepared,
        snapshot: document.querySelector('#math').scene.snapshot(),
      }));
      assert.deepEqual(initial.prepared, { first: 1, second: 0 });
      assert.deepEqual(await page.evaluate(() => lab.cleanup), [
        {
          calls: { presentation: 1, view: 1 },
          capture: { identity: 'custom' },
          failure: undefined,
        },
        { calls: { presentation: 1, view: 1 }, capture: undefined, failure: 'Broken presenter' },
      ]);
      assert.equal(
        await page.locator('#math').locator('input[aria-label="Количество"]').isDisabled(),
        true,
      );
      const work = await page.evaluate(() => {
        const started = performance.now();
        for (let i = 0; i < 100; i++) lab.math.story.seek((i % 80) / 10);
        return { elapsed: performance.now() - started, prepared: { ...lab.prepared } };
      });
      assert.deepEqual(
        work.prepared,
        { first: 1, second: 1 },
        'reverse seeks reuse each prepared chapter',
      );
      console.log('100 seeks with existing MathMorph:', work);
      await page.evaluate(() => lab.math.story.seek(8));
      const math = page.locator('#math');
      await math.getByRole('button', { name: 'Исследовать', exact: true }).click();
      for (const value of ['7', '8', '9'])
        await math.getByRole('slider', { name: 'Количество', exact: true }).fill(value);
      assert.equal(
        await page.evaluate(
          () => document.querySelector('#math').scene.snapshot().parameters.amount,
        ),
        9,
      );
      const prepared = await page.evaluate(() => ({ ...lab.prepared }));
      await math.getByRole('slider', { name: 'Преобразование', exact: true }).fill('0.7');
      await math.getByRole('slider', { name: 'Преобразование', exact: true }).fill('0.9');
      assert.deepEqual(
        await page.evaluate(() => ({ ...lab.prepared })),
        prepared,
        'the playhead never recompiles an operation',
      );
      await math.getByRole('button', { name: 'Рассказ', exact: true }).click();
      assert.equal(
        await page.evaluate(
          () => document.querySelector('#math').scene.snapshot().parameters.amount,
        ),
        6,
      );
      assert.equal(
        await page.evaluate(() =>
          document.querySelector('#math').scene.inspect().capabilities.includes('focus'),
        ),
        true,
      );
      await math.locator('canvas[tabindex="0"]').focus();
      await page.keyboard.press('ArrowRight');
      const saved = await page.evaluate(() => document.querySelector('#math').scene.capture());
      assert.equal(saved.view.kind, 'math-bodies');
      assert.equal(saved.view.projection, '3d');
      assert.equal(saved.view.camera.following, false);
      await page.evaluate(() =>
        document.querySelector('#math').scene.control([{ type: 'focus', ids: ['math-morph'] }]),
      );
      await math.getByRole('radio', { name: 'Плоскость', exact: true }).check();
      assert.equal(
        await page.evaluate(() =>
          document.querySelector('#math').scene.inspect().capabilities.includes('focus'),
        ),
        false,
      );
      assert.equal(
        (await page.evaluate(() => document.querySelector('#math').scene.capture())).view
          .projection,
        '2d',
      );
      const restored = await page.evaluate(async (saved) => {
        const scene = document.querySelector('#math').scene;
        const { restoreNotices: notices } = await scene.restore(saved);
        return {
          notices,
          view: scene.capture().view,
          projection: lab.math.presentation.projection,
          focus: scene.inspect().capabilities.includes('focus'),
        };
      }, saved);
      assert.deepEqual(restored.notices, []);
      assert.equal(restored.projection, '3d');
      assert.equal(restored.focus, true);
      const { camera: actualCamera, ...actualView } = restored.view;
      const { camera: expectedCamera, ...expectedView } = saved.view;
      assert.deepEqual(actualView, expectedView);
      const { position, target, ...cameraState } = actualCamera;
      const {
        position: expectedPosition,
        target: expectedTarget,
        ...expectedCameraState
      } = expectedCamera;
      assert.deepEqual(cameraState, expectedCameraState);
      // OrbitControls reconstructs spherical coordinates; one floating-point ULP is immaterial.
      for (const [actual, expected] of [
        [position, expectedPosition],
        [target, expectedTarget],
      ])
        assert.ok(actual.every((coordinate, i) => Math.abs(coordinate - expected[i]) < 1e-12));
      const ink = page.locator('#ink');
      await ink.getByRole('button', { name: 'Исследовать', exact: true }).click();
      await ink.getByRole('textbox', { name: 'Слово', exact: true }).fill('');
      assert.match(await ink.locator(':scope > [role=alert]').textContent(), /visible/);
      assert.equal(
        await page.evaluate(() => document.querySelector('#ink').scene.snapshot().parameters.word),
        'Свет',
        'invalid draft preserves the previous model',
      );
      await ink.getByRole('textbox', { name: 'Слово', exact: true }).fill('Форма');
      assert.equal(await ink.locator(':scope > [role=alert]').textContent(), '');
      assert.equal(
        await page.evaluate(() => document.querySelector('#ink').scene.snapshot().parameters.word),
        'Форма',
      );
      await page.setViewportSize({ width: 375, height: 900 });
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await page.evaluate(() => {
        lab.math.story.seek(0);
        lab.math.story.seek(8);
        lab.ink.story.seek(4);
      });
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      await page.evaluate(() => {
        lab.math.dispose();
        lab.math.dispose();
        lab.ink.dispose();
      });
      assert.equal(await page.locator('canvas').count(), 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
