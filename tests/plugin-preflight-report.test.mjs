import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

const document = {
  version: 1,
  model: { id: 'division', kind: 'division', count: 14, divisor: 3 },
  views: [
    { id: 'groups', kind: 'groups', model: 'division' },
    { id: 'equation', kind: 'equation', model: 'division' },
  ],
};

test(
  'rejected author preflight reports current viewer input without changing the accepted frame',
  { timeout: 30000 },
  async () => {
    const bundled = await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `import {mountExplanation} from './dist/explanation/mount.js';
        import './dist/style.css';
        window.__visualStorySession = {sessionId:'preflight',generation:1,stateRevision:0};
        window.galleryReady = mountExplanation(document.querySelector('main'), ${JSON.stringify(document)});
        import('./plugin/ui/scene-frame.mjs');`,
      },
      bundle: true,
      treeShaking: false,
      write: false,
      outdir: 'artifacts/preflight-bundle',
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
      await scene.getByRole('button', { name: 'Увеличить: Предметов', exact: true }).click();
      await scene.evaluate(() => document.querySelector('main').scene.ready());
      const before = await scene.evaluate(() => document.querySelector('main').scene.capture());
      const pixels = await scene.locator('[data-scene-frame]').screenshot();
      const stale = await command({
        id: 'stale',
        op: 'author-validate',
        stateRevision: explored.report.stateRevision,
        document,
      });
      assert.match(stale.error, /user changed/i);
      assert.ok(stale.report.stateRevision > explored.report.stateRevision);
      assert.equal(stale.report.state.parameters.find((p) => p.key === 'count').value, 15);
      assert.equal(stale.report.renderStatus, 'rendered');
      assert.equal(stale.report.observationError, undefined);
      const invalid = {
        ...document,
        score: [{ id: 'bad', action: 'group', text: 'W'.repeat(90) }],
      };
      const rejected = await command({
        id: 'invalid',
        op: 'author-validate',
        stateRevision: stale.report.stateRevision,
        document: invalid,
      });
      assert.ok(rejected.error);
      assert.equal(rejected.report.stateRevision, stale.report.stateRevision);
      assert.equal(rejected.report.renderStatus, 'rendered');
      assert.equal(rejected.report.observationError, undefined);
      assert.deepEqual(rejected.report.checkpoint, before);
      assert.deepEqual(
        await scene.evaluate(() => document.querySelector('main').scene.capture()),
        before,
      );
      assert.deepEqual(await scene.locator('[data-scene-frame]').screenshot(), pixels);
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
