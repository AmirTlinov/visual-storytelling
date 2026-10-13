import { validateStoryDocument } from '../dist/story/document.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

const document = validateStoryDocument({
  recipe: 'division',
  id: 'division',
  inputs: { count: 14, divisor: 3 },
});

test(
  'applied author identity survives viewer input abort during frame acknowledgement',
  { timeout: 30000 },
  async () => {
    const bundled = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import {IllustratedStory} from './dist/story/illustrated.js';
        import './dist/style.css';
        window.__visualStorySession = window.__testFrameConfig ?? {sessionId:'preflight',generation:1,stateRevision:0,buildRevision:'build-14',sourceRevision:'source-14'};
        window.galleryReady = IllustratedStory.mount(document.querySelector('main'), {document: window.__testDocument ?? ${JSON.stringify(document)}});
        import('./plugin/ui/scene-frame.mjs');`,
      },
      bundle: true,
      treeShaking: false,
      write: false,
      outdir: 'artifacts/author-race-bundle',
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
        '<script>window.messages=[];addEventListener("message",e=>messages.push(e.data))</script><iframe style="width:920px;height:700px;border:0"></iframe>',
      );
      const html = `<html lang="ru"><style>${bundled.outputFiles.find((f) => f.path.endsWith('.css')).text}</style><main class="ve-scene"></main><script>${bundled.outputFiles.find((f) => f.path.endsWith('.js')).text}</script></html>`;
      await page.locator('iframe').evaluate((frame, html) => {
        frame.srcdoc = html;
      }, html);
      await page.waitForFunction(() =>
        messages.some((m) => m.type === 'ready' || m.type === 'error'),
      );
      assert.equal(
        await page.evaluate(() => messages.find((m) => m.type === 'error')?.message),
        undefined,
      );
      const scene = page.frames().find((frame) => frame !== page.mainFrame());
      const command = async (request) => {
        await page.evaluate(
          (request) =>
            document.querySelector('iframe').contentWindow.postMessage(
              {
                channel: 'visual-story-scene-v1',
                sessionId: 'preflight',
                generation: 1,
                type: 'command',
                command: { expiresAt: Date.now() + 5000, ...request },
              },
              '*',
            ),
          request,
        );
        await page.waitForFunction(
          (id) => messages.some((m) => m.type === 'ack' && m.id === id),
          request.id,
        );
        return page.evaluate(
          (id) => messages.find((m) => m.type === 'ack' && m.id === id),
          request.id,
        );
      };
      const ready = await page.evaluate(() => messages.find((m) => m.type === 'ready').report);
      const explored = await command({
        id: 'explore',
        op: 'control',
        stateRevision: ready.stateRevision,
        commands: [
          { type: 'seek', time: 8 },
          { type: 'mode', value: 'explore' },
        ],
      });
      if (
        !(await scene
          .getByRole('button', { name: 'Увеличить: Предметов', exact: true })
          .isVisible())
      )
        await scene.getByRole('button', { name: 'Условия', exact: true }).click();
      // Focus is a real viewer action; inspect afterwards to use its accepted revision.
      await scene.getByRole('button', { name: 'Увеличить: Предметов', exact: true }).focus();
      const inspected = await command({ id: 'before-author', op: 'inspect' });
      await scene.evaluate(() => {
        const realRAF = window.requestAnimationFrame.bind(window);
        const realCancelRAF = window.cancelAnimationFrame.bind(window);
        const realTimeout = window.setTimeout.bind(window);
        const callbacks = new Map();
        let heldId = -1;
        const timers = new Map();
        const realClearTimeout = window.clearTimeout.bind(window);
        window.raceGate = { active: false, frames: 0 };
        addEventListener(
          'keydown',
          (event) => {
            if (raceGate.active) raceGate.trustedInput = event.isTrusted;
          },
          { capture: true },
        );
        window.requestAnimationFrame = (callback) => {
          if (!raceGate.active) return realRAF(callback);
          const id = heldId--;
          callbacks.set(id, callback);
          raceGate.frames++;
          return id;
        };
        window.cancelAnimationFrame = (id) => {
          if (id < 0) callbacks.delete(id);
          else realCancelRAF(id);
        };
        window.setTimeout = (callback, delay, ...args) => {
          if (raceGate.active && delay === 150) {
            const id = heldId--;
            timers.set(id, () => realTimeout(callback, delay, ...args));
            return id;
          }
          return realTimeout(callback, delay, ...args);
        };
        window.clearTimeout = (id) => {
          if (id < 0) timers.delete(id);
          else realClearTimeout(id);
        };
        const owner = document.querySelector('main').scene.authoring;
        const replace = owner.replace.bind(owner);
        owner.replace = async (...args) => {
          await replace(...args);
          // Arm only after the real document and drawing have committed.
          raceGate.active = true;
        };
        raceGate.release = () => {
          raceGate.active = false;
          window.requestAnimationFrame = realRAF;
          window.cancelAnimationFrame = realCancelRAF;
          window.setTimeout = realTimeout;
          window.clearTimeout = realClearTimeout;
          owner.replace = replace;
          for (const callback of callbacks.values()) realRAF(callback);
          callbacks.clear();
          for (const resume of timers.values()) resume();
          timers.clear();
        };
      });
      const authored = {
        ...document,
        models: [{ ...document.models[0], inputs: { ...document.models[0].inputs, count: 17 } }],
      };
      const author = command({
        id: 'attempt-17',
        requestId: 'operation-17',
        op: 'author',
        stateRevision: inspected.report.stateRevision,
        document: authored,
        authoredInputs: ['count'],
        nextBuildRevision: 'build-17',
        sourceRevision: 'source-17',
      });
      await scene.waitForFunction(() => raceGate.active && raceGate.frames > 0, undefined, {
        polling: 10,
      });
      assert.equal(
        await scene.evaluate(
          () => document.querySelector('main').scene.authoring.document.models[0].inputs.count,
        ),
        17,
      );
      await page.keyboard.press('Enter');
      assert.equal(await scene.evaluate(() => raceGate.trustedInput), true);
      await scene.evaluate(() => raceGate.release());
      const aborted = await author;
      assert.equal(await scene.locator('[data-division-role]').count(), 18);
      assert.match(aborted.error, /user changed/i);
      assert.equal(aborted.report.authoring.requestId, 'operation-17');
      assert.equal(aborted.report.authoring.commandId, 'attempt-17');
      assert.equal(aborted.report.authoring.buildRevision, 'build-17');
      assert.equal(aborted.report.authoring.sourceRevision, 'source-17');
      // The capture-phase abort can report before the button's default click applies input.
      assert.ok([17, 18].includes(aborted.report.state.rendering.requested.values.count));
      await page.waitForFunction(() =>
        messages.some(
          (m) =>
            m.type === 'report' &&
            m.report.reason === 'input' &&
            m.report.state.parameters.find((p) => p.key === 'count').value === 18,
        ),
      );
      const observed = await page.evaluate(
        () =>
          messages.filter((m) => m.type === 'report' && m.report.reason === 'input').at(-1).report,
      );
      assert.equal(observed.authoring.buildRevision, 'build-17');
      assert.equal(observed.authoring.sourceRevision, 'source-17');
      assert.equal(observed.renderStatus, 'rendered');
      const recovered = await command({ id: 'recover', op: 'inspect' });
      assert.equal(recovered.report.authoring.buildRevision, 'build-17');
      assert.equal(recovered.report.authoring.sourceRevision, 'source-17');
      assert.equal(recovered.report.state.parameters.find((p) => p.key === 'count').value, 18);
      const continued = await command({
        id: 'continue',
        op: 'control',
        stateRevision: recovered.report.stateRevision,
        commands: [{ type: 'parameters', values: { divisor: 4 } }],
      });
      assert.equal(continued.error, undefined);
      assert.equal(continued.report.state.parameters.find((p) => p.key === 'count').value, 18);
      assert.equal(continued.report.state.parameters.find((p) => p.key === 'divisor').value, 4);
      assert.equal(
        await scene.evaluate(
          () => document.querySelector('main').scene.authoring.document.models[0].inputs.count,
        ),
        17,
      );
      const checkpoint = await scene.evaluate(() => document.querySelector('main').scene.capture());
      const reattached = {
        sessionId: 'preflight',
        generation: 1,
        stateRevision: continued.report.stateRevision,
        buildRevision: 'build-17',
        sourceRevision: 'source-17',
        authoring: continued.report.authoring,
        checkpoint,
      };
      await page.evaluate(() => {
        window.messages = [];
      });
      await page.locator('iframe').evaluate(
        (frame, html) => {
          frame.srcdoc = html;
        },
        html.replace(
          '<script>',
          `<script>window.__testFrameConfig=${JSON.stringify(reattached)};window.__testDocument=${JSON.stringify(authored)};`,
        ),
      );
      await page.waitForFunction(() =>
        messages.some((m) => m.type === 'ready' || m.type === 'error'),
      );
      assert.equal(
        await page.evaluate(() => messages.find((m) => m.type === 'error')?.message),
        undefined,
      );
      const remounted = await page.evaluate(() => messages.find((m) => m.type === 'ready').report);
      assert.deepEqual(remounted.authoring, continued.report.authoring);
      assert.equal(remounted.state.parameters.find((p) => p.key === 'count').value, 18);
      assert.equal(remounted.state.parameters.find((p) => p.key === 'divisor').value, 4);
      assert.deepEqual(remounted.checkpoint, checkpoint);
      const remountedScene = page.frames().find((frame) => frame !== page.mainFrame());
      assert.equal(
        await remountedScene.evaluate(
          () => document.querySelector('main').scene.authoring.document.models[0].inputs.count,
        ),
        17,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
