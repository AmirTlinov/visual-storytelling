import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test(
  'the live division keeps complete quantities, viewer choices and its scene handle through authoring and replay',
  { timeout: 120000 },
  async () => {
    const bundled = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
      import {IllustratedStory} from './dist/story/illustrated.js';
      import './dist/style.css';
      window.mountDocument = IllustratedStory.mount;
      window.ready = IllustratedStory.mount(document.querySelector('main'), {document:{
        recipe:'division',inputs:{count:17,divisor:5},
        views:[{id:'objects',kind:'groups',model:'division'},{id:'identity',kind:'equation',model:'division'}],
      }}).then(({scene}) => window.lab = {scene});
    `,
      },
      bundle: true,
      write: false,
      outdir: 'artifacts/live-milestone/browser-bundle',
      format: 'iife',
      plugins: [assetURLs()],
      loader: { '.woff2': 'dataurl' },
      define: { 'import.meta.url': 'document.baseURI' },
    });
    const directory = 'artifacts/live-milestone/division';
    await mkdir(directory, { recursive: true });
    const browser = await chromium.launch(chromiumLaunchOptions());
    const observations = [];
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(
        '<!doctype html><html lang="ru"><head></head><body><main class="ve-scene"></main></body></html>',
      );
      await page.addStyleTag({
        content: bundled.outputFiles.find((file) => file.path.endsWith('.css')).text,
      });
      await page.addScriptTag({
        content: bundled.outputFiles.find((file) => file.path.endsWith('.js')).text,
      });
      await page.evaluate(() => window.ready);
      await page.locator('[data-scene-frame]').screenshot({ path: `${directory}/initial.png` });
      const observe = () =>
        page.evaluate(() => {
          const scene = lab.scene,
            state = scene.snapshot(),
            drawing = document.querySelector('[data-division]');
          const items = [...drawing.querySelectorAll('[data-division-role]')];
          const frame = document.querySelector('[data-scene-frame]').getBoundingClientRect();
          const bounds = items.map((item) => item.getBoundingClientRect());
          return {
            state,
            time: scene.currentTime,
            mode: scene.inspect({ presentation: false }).mode,
            count: items.length,
            completed: Number(drawing.dataset.completedGroups),
            ungrouped: Number(drawing.dataset.ungrouped),
            complete: drawing.dataset.complete === 'true',
            visibleIdentity:
              getComputedStyle(drawing.querySelector('[data-object="identity"]')).display !==
              'none',
            ids: items.map((item) => item.dataset.object),
            sameHandle: document.querySelector('main').scene === scene,
            overflow: document.documentElement.scrollWidth > innerWidth,
            objectsInside: bounds.every(
              (b) =>
                b.left >= frame.left - 1 &&
                b.right <= frame.right + 1 &&
                b.top >= frame.top - 1 &&
                b.bottom <= frame.bottom + 1,
            ),
          };
        });
      for (const time of [0, 1.2, 2, 2.5333333, 2.54, 4, 5.2, 8, 2]) {
        await page.evaluate((time) => lab.scene.seek(time), time);
        const frame = await observe();
        observations.push(frame);
        assert.equal(frame.count, 17);
        assert.equal(frame.completed * 5 + frame.ungrouped, 17);
        assert.equal(new Set(frame.ids).size, 17);
        assert(frame.sameHandle);
        assert(frame.objectsInside);
        if (!frame.complete) assert.equal(frame.visibleIdentity, false, JSON.stringify(frame));
      }
      await page.evaluate(() => lab.scene.seek(5.2));
      await page.getByRole('button', { name: 'Исследовать', exact: true }).click();
      if (
        !(await page.getByRole('button', { name: 'Увеличить: Предметов', exact: true }).isVisible())
      )
        await page.getByRole('button', { name: 'Условия', exact: true }).click();
      await page.getByRole('button', { name: 'Увеличить: Предметов', exact: true }).click();
      assert.equal((await observe()).state.count, 18);
      await page.evaluate(() => {
        lab.scene.seek(2);
        lab.scene.setRate(2);
      });
      await page.evaluate(async () => {
        const doc = structuredClone(lab.scene.authoring.document);
        doc.chapters[0].beats = [
          { id: 'collect', operation: { model: 'division', name: 'group' }, seconds: 4 },
          { id: 'notice', focus: ['division:remainder'], hold: 'Сравнить остаток', seconds: 2 },
        ];
        await lab.scene.authoring.replace(doc);
      });
      let frame = await observe();
      assert(frame.sameHandle);
      assert.equal(frame.state.count, 18);
      assert.equal(frame.mode, 'explore');
      assert.equal(frame.time, 2);
      assert.equal(await page.evaluate(() => lab.scene.rate), 2);
      const before = await page.evaluate(() => ({
        doc: lab.scene.authoring.document,
        state: lab.scene.snapshot(),
        svg: document.querySelector('[data-division]').outerHTML,
      }));
      const failure = await page.evaluate(async () => {
        const doc = structuredClone(lab.scene.authoring.document);
        doc.models[0].inputs.divisor = 0;
        try {
          await lab.scene.authoring.replace(doc);
        } catch (error) {
          return error.message;
        }
      });
      assert.match(failure, /divisor/);
      const futureFailure = await page.evaluate(async () => {
        const doc = structuredClone(lab.scene.authoring.document);
        doc.chapters[0].beats[1].text = 'x'.repeat(90);
        try {
          await lab.scene.authoring.replace(doc);
        } catch (error) {
          return error.message;
        }
      });
      assert.match(futureFailure, /wider drawing/);
      const timingFailures = await page.evaluate(() => {
        const messages = [];
        for (const timing of [{ until: 'collect' }, { until: 'experience.notice', delay: 99 }]) {
          const doc = structuredClone(lab.scene.authoring.document);
          doc.chapters[0].beats[0].timing = timing;
          try {
            lab.scene.authoring.validate(doc);
          } catch (error) {
            messages.push(error.message);
          }
        }
        const doc = structuredClone(lab.scene.authoring.document);
        doc.chapters[0].beats[0].timing = { until: 'later.end' };
        doc.chapters.push({ id: 'later', title: 'Позже', beats: [{ id: 'end', seconds: 1 }] });
        try {
          lab.scene.authoring.validate(doc);
        } catch (error) {
          messages.push(error.message);
        }
        return messages;
      });
      assert.equal(
        timingFailures.length,
        3,
        'preflight must reject every timeline that replacement cannot compile',
      );

      assert.deepEqual(
        await page.evaluate(() => ({
          doc: lab.scene.authoring.document,
          state: lab.scene.snapshot(),
          svg: document.querySelector('[data-division]').outerHTML,
        })),
        before,
      );
      for (const [count, divisor] of [
        [0, 5],
        [2, 5],
        [20, 5],
        [21, 5],
        [36, 1],
        [36, 12],
      ]) {
        await page.evaluate(
          async ({ count, divisor }) => {
            const doc = structuredClone(lab.scene.authoring.document);
            Object.assign(doc.models[0].inputs, { count, divisor });
            await lab.scene.authoring.replace(doc);
            lab.scene.seek(lab.scene.duration);
          },
          { count, divisor },
        );
        frame = await observe();
        assert.equal(frame.count, count);
        assert.equal(frame.state.count, frame.state.quotient * divisor + frame.state.remainder);
        assert(frame.state.remainder >= 0 && frame.state.remainder < divisor);
        assert(frame.objectsInside);
      }
      for (const width of [960, 375])
        for (const colorScheme of ['light', 'dark']) {
          await page.setViewportSize({ width, height: 760 });
          await page.emulateMedia({ colorScheme });
          await page.evaluate(async () => {
            const doc = structuredClone(lab.scene.authoring.document);
            Object.assign(doc.models[0].inputs, { count: 17, divisor: 5 });
            await lab.scene.authoring.replace(doc);
            lab.scene.seek(lab.scene.duration);
          });
          await page.evaluate(
            () =>
              new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          frame = await observe();
          assert(!frame.overflow);
          assert(frame.objectsInside);
          await page
            .locator('[data-scene-frame]')
            .screenshot({ path: `${directory}/${width}-${colorScheme}.png` });
        }
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => {
        lab.scene.setReduced(true);
        lab.scene.seek(2);
      });
      frame = await observe();
      assert.equal(frame.count, 17);
      assert.equal(frame.completed * 5 + frame.ungrouped, 17);
      const reducedPositions = await page
        .locator('[data-division-role]')
        .evaluateAll((items) => items.map((item) => item.getAttribute('transform')));
      await page.evaluate(() => lab.scene.seek(3));
      assert.deepEqual(
        await page
          .locator('[data-division-role]')
          .evaluateAll((items) => items.map((item) => item.getAttribute('transform'))),
        reducedPositions,
      );
      await page.evaluate(async () => {
        const document = structuredClone(lab.scene.authoring.document);
        lab.narrative = structuredClone(document);
        document.chapters = [];
        await lab.scene.authoring.replace(document);
      });
      assert.deepEqual(
        await page.evaluate(() => ({
          play: typeof lab.scene.play,
          seek: typeof lab.scene.seek,
          duration: lab.scene.duration,
          mode: lab.scene.inspect({ presentation: false }).mode,
        })),
        { play: 'undefined', seek: 'undefined', duration: undefined, mode: 'explore' },
      );
      assert.equal((await observe()).completed, 3);
      await page.evaluate(() => lab.scene.control([{ type: 'parameters', values: { count: 18 } }]));
      assert.equal((await observe()).state.count, 18);
      await page.evaluate(() => lab.scene.authoring.replace(lab.narrative));
      assert.equal((await observe()).state.count, 18);
      assert.equal(typeof (await page.evaluate(() => lab.scene.duration)), 'number');
      assert.equal((await observe()).sameHandle, true);
      const staticResult = await page.evaluate(async () => {
        const root = document.createElement('main');
        root.className = 've-scene';
        document.body.append(root);
        const { scene, story } = await window.mountDocument(root, {
          document: { recipe: 'division', inputs: { count: 17, divisor: 5 }, chapters: [] },
        });
        const initial = {
          story: typeof story,
          play: typeof scene.play,
          seek: typeof scene.seek,
          count: scene.snapshot().count,
        };
        await scene.control([{ type: 'parameters', values: { count: 19 } }]);
        const captured = scene.capture();
        await scene.control([{ type: 'parameters', values: { count: 20 } }]);
        await scene.restore(captured);
        const restored = scene.snapshot().count;
        const same = structuredClone(scene.authoring.document);
        await scene.authoring.replace(same, { authoredInputs: ['count'] });
        const authored = scene.snapshot().count;
        scene.dispose();
        root.remove();
        return { initial, restored, authored };
      });
      assert.deepEqual(staticResult, {
        initial: { story: 'undefined', play: 'undefined', seek: 'undefined', count: 17 },
        restored: 19,
        authored: 17,
      });
      const failedFactory = await page.evaluate(async () => {
        const root = document.createElement('main');
        document.body.append(root);
        try {
          await window.mountDocument(root, {
            document: { recipe: 'division', inputs: { count: 17, divisor: 5 }, chapters: [] },
            subjects: {
              division: {
                title: 'Failure',
                parameters: () => [],
                create() {
                  throw new Error('factory failed');
                },
              },
            },
          });
        } catch (error) {
          const result = { message: error.message, attached: !!root.scene };
          root.remove();
          return result;
        }
      });
      assert.deepEqual(failedFactory, { message: 'factory failed', attached: false });

      const nonIdempotent = await page.evaluate(async () => {
        const root = document.createElement('main');
        document.body.append(root);
        const counter = {
          validateInputs: ({ value }) => ({ value }),
          state: ({ value }) => ({ value, derived: value }),
          operations: { double: (state) => ({ value: state.value * 2, derived: state.value * 2 }) },
          validateViews() {},
          focusTargets: () => [],
        };
        const subject = {
          title: 'Counter',
          parameters: (model) => [
            { key: 'value', label: 'Value', value: model.inputs.value, min: 0, max: 20 },
          ],
          create() {
            return {
              validate() {},
              render() {},
              snapshot: (state) => ({ ...state }),
              dispose() {},
            };
          },
        };
        const { scene } = await window.mountDocument(root, {
          document: {
            version: 2,
            models: [{ id: 'counter', module: 'counter', inputs: { value: 3 } }],
            views: [],
            chapters: [
              {
                id: 'math',
                title: 'Math',
                beats: [
                  { id: 'double', operation: { model: 'counter', name: 'double' }, seconds: 2 },
                ],
              },
            ],
          },
          modules: { counter },
          subjects: { counter: subject },
        });
        const initial = scene.snapshot();
        await scene.control([{ type: 'parameters', values: { value: 4 } }]);
        const edited = scene.snapshot();
        scene.seek(1);
        const sought = scene.snapshot();
        await scene.control([{ type: 'mode', value: 'story' }]);
        const resumed = scene.snapshot();
        scene.dispose();
        root.remove();
        return { initial, edited, sought, resumed };
      });
      assert.deepEqual(nonIdempotent, {
        initial: { value: 6, derived: 6 },
        edited: { value: 8, derived: 8 },
        sought: { value: 8, derived: 8 },
        resumed: { value: 6, derived: 6 },
      });
      assert.deepEqual(errors, []);
      await writeFile(`${directory}/observations.json`, JSON.stringify(observations, null, 2));
    } finally {
      await browser.close();
    }
  },
);
