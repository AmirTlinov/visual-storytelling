import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test(
  'a static document retains one scene and subject through authored timing and back',
  { timeout: 120000 },
  async () => {
    const bundled = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
      import {IllustratedStory} from './src/story/illustrated.ts';
      import {divisionStory} from './src/recipes/division-story.ts';
      const mountDocument = async(root, source, options={}) => (await IllustratedStory.mount(root,{...options,document:source})).scene;
      import {SceneShell} from './src/scene.ts';
      import './dist/style.css';
      window.mountDocument = mountDocument;
      window.divisionStory = divisionStory;
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
      window.ready = mountDocument(document.querySelector('main'), divisionStory({inputs:{count:17,divisor:5},chapters:[]}), {audio}).then(scene => window.lab = {scene, audio});
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
        const timed = divisionStory({
          inputs: { count: 17, divisor: 5 },
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
