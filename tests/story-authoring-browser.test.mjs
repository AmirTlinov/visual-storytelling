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
      import {mountStoryDocument} from './src/story/mount.ts';
      import {normalizeStoryDocument} from './src/story/document.ts';
      import './dist/style.css';
      window.ready = mountStoryDocument(document.querySelector('main'), {
        ...normalizeStoryDocument({model:{kind:'division',count:17,divisor:5}}),
        views:[{id:'objects',kind:'groups',model:'division'},{id:'identity',kind:'equation',model:'division'}],
      }).then(scene => window.lab = {scene});
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
          {
            id: 'collect',
            say: '',
            staging: { model: 'division', operation: 'group' },
            seconds: 4,
          },
          {
            id: 'notice',
            say: '',
            staging: { model: 'division', focus: ['remainder'] },
            hold: 'Рассмотреть остаток',
            seconds: 2,
          },
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
      assert.deepEqual(errors, []);
      await writeFile(`${directory}/observations.json`, JSON.stringify(observations, null, 2));
    } finally {
      await browser.close();
    }
  },
);

test(
  'a static document retains one scene and subject through authored timing and back',
  { timeout: 120000 },
  async () => {
    const bundled = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
      import {mountStoryDocument} from './src/story/mount.ts';
      import {normalizeStoryDocument} from './src/story/document.ts';
      import {SceneShell} from './src/scene.ts';
      import './dist/style.css';
      window.mountStoryDocument = mountStoryDocument;
      window.normalizeStoryDocument = normalizeStoryDocument;
      const mountShell = SceneShell.mount;
      SceneShell.mount = (...args) => {
        const shell = mountShell(...args);
        const attach = shell.attachController;
        shell.attachController = controller => {window.controller = controller; return attach(controller);};
        return shell;
      };
      window.cleanupDiagnostics = [];
      window.disposeCalls = 0;
      document.querySelector('main').addEventListener('scene-playback-error', event => {
        window.cleanupDiagnostics.push({message: event.detail.message, document: lab.scene.authoring.document, snapshot: lab.scene.snapshot()});
      });
      window.failDisposal = () => {
        const current = window.controller;
        const dispose = current.dispose;
        current.dispose = () => {window.disposeCalls++; dispose(); throw Error('injected old player cleanup');};
      };
      window.fetches = 0;
      window.fetch = () => {window.fetches++; throw Error('unexpected timing fetch');};
      const audio = document.createElement('audio');
      audio.dataset.storyTimeline = 'should-not-load.json';
      window.ready = mountStoryDocument(document.querySelector('main'), normalizeStoryDocument({model:{kind:'division',count:17,divisor:5},chapters:[]}), {audio}).then(scene => window.lab = {scene, audio});
    `,
      },
      bundle: true,
      write: false,
      outdir: 'artifacts/live-milestone/static-bundle',
      format: 'iife',
      plugins: [assetURLs()],
      loader: { '.woff2': 'dataurl' },
      define: { 'import.meta.url': 'document.baseURI' },
    });
    const browser = await chromium.launch(chromiumLaunchOptions());
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(
        '<!doctype html><html lang="ru"><body><main class="ve-scene"></main></body></html>',
      );
      await page.addStyleTag({
        content: bundled.outputFiles.find((file) => file.path.endsWith('.css')).text,
      });
      await page.addScriptTag({
        content: bundled.outputFiles.find((file) => file.path.endsWith('.js')).text,
      });
      await page.evaluate(() => window.ready);
      const inspect = () =>
        page.evaluate(() => ({
          same: document.querySelector('main').scene === lab.scene,
          snapshot: lab.scene.snapshot(),
          capabilities: lab.scene.inspect({ presentation: false }).capabilities,
          duration: lab.scene.duration ?? null,
          review: lab.scene.review(),
          complete: document.querySelector('[data-division]').dataset.complete,
          ids: [...document.querySelectorAll('[data-division-role]')].map(
            (item) => item.dataset.object,
          ),
          playerHidden: document.querySelector('[data-player]').hidden,
          fetches: window.fetches,
        }));
      const initial = await inspect();
      assert.equal(initial.fetches, 0);
      assert.equal(initial.duration, null);
      assert.deepEqual(initial.review.cues, []);
      assert.equal(initial.complete, 'true');
      assert(initial.playerHidden);
      assert(!initial.capabilities.includes('seek'));
      assert(!initial.capabilities.includes('play'));
      if (
        !(await page.getByRole('button', { name: 'Увеличить: Предметов', exact: true }).isVisible())
      )
        await page.getByRole('button', { name: 'Условия', exact: true }).click();
      await page.getByRole('button', { name: 'Увеличить: Предметов', exact: true }).click();
      assert.equal((await inspect()).snapshot.count, 18);
      await page.evaluate(async () => {
        const timed = normalizeStoryDocument({
          model: { kind: 'division', count: 17, divisor: 5 },
        });
        await lab.scene.authoring.replace(timed);
      });
      const timed = await inspect();
      assert(timed.same);
      assert.equal(timed.snapshot.count, 18);
      assert.equal(timed.duration, 8);
      assert.equal(timed.fetches, 0, 'quiet timing does not load retained narration');
      assert(!timed.capabilities.includes('mute'), 'quiet revision has no stale narration audio');
      assert.equal(timed.complete, 'true');
      assert(!timed.playerHidden);
      assert(timed.capabilities.includes('seek'));
      assert.deepEqual(timed.ids.slice(0, 17), initial.ids);
      await page.evaluate(async () => {
        failDisposal();
        const next = structuredClone(lab.scene.authoring.document);
        next.title = 'После замены';
        await lab.scene.authoring.replace(next);
      });
      const cleanup = await page.evaluate(() => ({
        diagnostics: window.cleanupDiagnostics,
        calls: window.disposeCalls,
      }));
      assert.equal(cleanup.calls, 1);
      assert.equal(cleanup.diagnostics.length, 1);
      assert.equal(cleanup.diagnostics[0].document.title, 'После замены');
      assert.equal(cleanup.diagnostics[0].snapshot.count, 18);
      assert.equal((await inspect()).duration, 8);
      await page.evaluate(() => {
        lab.scene.seek(2);
        lab.scene.setRate(2);
      });
      await page.evaluate(async () => {
        failDisposal();
        const document = structuredClone(lab.scene.authoring.document);
        document.chapters = [];
        await lab.scene.authoring.replace(document);
      });
      const restored = await inspect();
      assert(restored.same);
      assert.equal(restored.snapshot.count, 18);
      assert.equal(restored.duration, null);
      assert.equal(restored.complete, 'true');
      assert.deepEqual(restored.ids, timed.ids);
      const finalCleanup = await page.evaluate(() => ({
        diagnostics: window.cleanupDiagnostics,
        calls: window.disposeCalls,
      }));
      assert.equal(finalCleanup.calls, 2, 'each replaced player is disposed once');
      assert.equal(finalCleanup.diagnostics.length, 2);
      assert.deepEqual(finalCleanup.diagnostics[1].document.chapters, []);
      assert.equal(finalCleanup.diagnostics[1].snapshot.count, 18);
      assert(restored.playerHidden);
      for (const capability of ['seek', 'play', 'pause', 'cue', 'rate', 'reduced'])
        assert(!restored.capabilities.includes(capability));
      await page.setViewportSize({ width: 375, height: 760 });
      await page.evaluate(
        () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
      );
      assert.equal((await inspect()).snapshot.count, 18);
      const failed = await page.evaluate(async () => {
        const before = lab.scene.authoring.document;
        const invalid = structuredClone(before);
        invalid.models[0].inputs.divisor = 0;
        try {
          await lab.scene.authoring.replace(invalid);
        } catch (error) {
          return { message: error.message, before, after: lab.scene.authoring.document };
        }
      });
      assert.match(failed.message, /divisor/);
      assert.deepEqual(failed.before, failed.after);
      assert.deepEqual(errors, []);
      await page.evaluate(() => lab.scene.dispose());
    } finally {
      await browser.close();
    }
  },
);
