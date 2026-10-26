import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test(
  'streamed identity settles in the same scene; confirmation fences queued previews and ordinary edits cannot rename it',
  { timeout: 30000 },
  async () => {
    const [adapter, bundle] = await Promise.all([
      build({
        entryPoints: ['plugin/ui/scene-frame.mjs'],
        bundle: true,
        write: false,
        format: 'iife',
      }),
      build({
        stdin: {
          resolveDir: process.cwd(),
          contents: `
          import {IllustratedStory} from './dist/story/illustrated.js';
          import './dist/style.css';
          window.galleryReady = IllustratedStory.mount(document.querySelector('main'), {document: {
            recipe:'division',inputs:{count:11,divisor:3}
          }}).then(({scene}) => {window.initialScene = scene});
        `,
        },
        bundle: true,
        write: false,
        outdir: 'artifacts/live-identity-test',
        format: 'iife',
        plugins: [assetURLs()],
        loader: { '.woff2': 'dataurl' },
        define: { 'import.meta.url': 'document.baseURI' },
      }),
    ]);
    const browser = await chromium.launch(chromiumLaunchOptions());
    try {
      const page = await browser.newPage({ viewport: { width: 960, height: 760 } });
      page.setDefaultTimeout(5000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(
        '<iframe title="Scene" sandbox="allow-scripts" style="width:900px;height:700px"></iframe>',
      );
      const script = (text) => `<script>${text.replace(/<\/script/gi, '<\\/script')}</script>`;
      const html = `<!doctype html><html lang="ru"><head><style>${bundle.outputFiles.find((f) => f.path.endsWith('.css')).text}</style></head><body><main class="ve-scene"></main>${script(bundle.outputFiles.find((f) => f.path.endsWith('.js')).text)}${script('window.__visualStorySession={sessionId:"preview",generation:-1,stateRevision:0,preview:true,provisional:true}')}${script(adapter.outputFiles[0].text)}</body></html>`;
      await page.evaluate((html) => {
        window.messages = [];
        addEventListener('message', (event) => {
          if (event.data?.channel === 'visual-story-scene-v1') messages.push(event.data);
        });
        document.querySelector('iframe').srcdoc = html;
      }, html);
      await page.waitForFunction(() => messages.some((message) => message.type === 'ready'));
      const frame = page.frames().find((frame) => frame.url() === 'about:srcdoc');
      const observe = () =>
        frame.evaluate(() => ({
          document: initialScene.authoring.document,
          state: initialScene.snapshot(),
          sameHandle: document.querySelector('main').scene === initialScene,
          ids: [...document.querySelectorAll('[data-division-role]')].map(
            (element) => element.dataset.object,
          ),
        }));
      assert.equal((await observe()).document.models[0].id, 'division');
      const send = (request, sessionId = 'preview', generation = -1) =>
        page.evaluate(
          ({ request, sessionId, generation }) => {
            document
              .querySelector('iframe')
              .contentWindow.postMessage(
                { channel: 'visual-story-scene-v1', sessionId, generation, ...request },
                '*',
              );
          },
          { request, sessionId, generation },
        );
      await send({
        type: 'author-preview',
        document: { recipe: 'division', id: 'apples', inputs: { count: 11, divisor: 3 } },
      });
      await page.waitForFunction(() =>
        messages.some((message) => message.type === 'preview-content'),
      );
      const preview = await observe();
      assert.equal(preview.document.models[0].id, 'apples');
      assert.equal(preview.state.id, 'apples');
      assert.ok(preview.ids.every((id) => id.startsWith('apples:')));
      assert.ok(preview.sameHandle);
      const canonical = { ...preview.document, title: 'Confirmed' };
      // Hold the real owner briefly so a stale preview definitely enters the bridge queue
      // while provisional is still true, behind the confirmation which will fix identity.
      await frame.evaluate(() => {
        window.authoringCalls = [];
        const owner = initialScene.authoring;
        const replace = owner.replace;
        owner.replace = async (document, options) => {
          authoringCalls.push({
            id: document.models[0].id,
            provisional: options?.provisional === true,
          });
          if (document.title === 'Confirmed') {
            window.confirmationEntered = true;
            await new Promise((resolve) => {
              window.releaseConfirmation = resolve;
            });
          }
          return replace(document, options);
        };
        addEventListener('message', (event) => {
          if (event.data?.document?.id === 'stale') window.staleReceived = true;
        });
      });
      await send({
        type: 'confirm-preview',
        document: canonical,
        nextSessionId: 'confirmed',
        nextGeneration: 1,
        stateRevision: 7,
      });
      await frame.waitForFunction(() => window.confirmationEntered);
      await send({
        type: 'author-preview',
        document: { recipe: 'division', id: 'stale', inputs: { count: 30, divisor: 6 } },
      });
      await frame.waitForFunction(() => window.staleReceived);
      await frame.evaluate(() => window.releaseConfirmation());
      await page.waitForFunction(() =>
        messages.some((message) => message.type === 'ready' && message.sessionId === 'confirmed'),
      );
      const command = async (request) => {
        const id = randomUUID();
        await send(
          { type: 'command', command: { ...request, id, expiresAt: Date.now() + 3000 } },
          'confirmed',
          1,
        );
        await page.waitForFunction(
          (id) => messages.some((message) => message.type === 'ack' && message.id === id),
          id,
        );
        return page.evaluate(
          (id) => messages.find((message) => message.type === 'ack' && message.id === id),
          id,
        );
      };
      // This queued inspect is a barrier after the stale preview, with no timing guess.
      const confirmed = await command({ op: 'inspect' });
      assert.equal(confirmed.error, undefined);
      assert.deepEqual((await observe()).document, canonical);
      assert.deepEqual(await frame.evaluate(() => window.authoringCalls), [
        { id: 'apples', provisional: true },
      ]);
      assert.ok(page.frames().includes(frame), 'confirmation preserves the iframe');
      assert.ok((await observe()).sameHandle);
      const edited = {
        ...canonical,
        title: 'Edited',
        models: [{ ...canonical.models[0], inputs: { ...canonical.models[0].inputs, count: 17 } }],
      };
      const accepted = await command({
        op: 'author',
        stateRevision: 7,
        document: edited,
        nextBuildRevision: 'build-edited',
        sourceRevision: 'source-edited',
      });
      assert.equal(accepted.error, undefined);
      assert.equal(accepted.report.stateRevision, 8);
      assert.equal(accepted.report.renderStatus, 'rendered');
      const beforeRename = await observe();
      assert.deepEqual(beforeRename.document, edited);
      assert.equal(beforeRename.state.count, 17);
      const rename = {
        ...edited,
        models: [{ ...edited.models[0], id: 'oranges' }],
        chapters: edited.chapters.map((chapter) => ({
          ...chapter,
          beats: chapter.beats.map((beat) => ({
            ...beat,
            ...(beat.operation && { operation: { ...beat.operation, model: 'oranges' } }),
            ...(beat.focus && {
              focus: beat.focus.map((target) => target.replace('apples:', 'oranges:')),
            }),
          })),
        })),
        views: edited.views.map((view) => ({ ...view, model: 'oranges' })),
      };
      const invalid = await command({
        op: 'author',
        stateRevision: 8,
        document: rename,
        provisional: true,
        nextBuildRevision: 'bad-build',
        sourceRevision: 'bad-source',
      });
      assert.match(invalid.error, /retain the prepared subject identity/i);
      assert.deepEqual(
        await observe(),
        beforeRename,
        'an ordinary command cannot opt into a provisional rename',
      );
      assert.deepEqual(await frame.evaluate(() => window.authoringCalls), [
        { id: 'apples', provisional: true },
        { id: 'apples', provisional: false },
        { id: 'oranges', provisional: false },
      ]);
      // The same accepted subject can gain and release its narrative owner repeatedly.
      for (const [index, narrative] of [false, true, false].entries()) {
        const before = await command({ op: 'inspect' });
        const replacement = { ...edited, chapters: narrative ? edited.chapters : [] };
        const replaced = await command({
          op: 'author',
          stateRevision: before.report.stateRevision,
          document: replacement,
          nextBuildRevision: `transition-${index}`,
          sourceRevision: `transition-source-${index}`,
        });
        assert.equal(replaced.error, undefined);
        assert.ok((await observe()).sameHandle);
        assert.ok(page.frames().includes(frame));
        const state = replaced.report.state;
        assert.equal(state.capabilities.includes('seek'), narrative);
        assert.equal(state.capabilities.includes('play'), narrative);
        assert.equal(state.capabilities.includes('cue'), narrative);
        assert.equal(state.duration, narrative ? 8 : 0);
        const controlled = await command({
          op: 'control',
          stateRevision: replaced.report.stateRevision,
          commands: [{ type: 'parameters', values: { count: 22 + index } }],
        });
        assert.equal(controlled.error, undefined);
        assert.equal(
          controlled.report.state.parameters.find((p) => p.key === 'count').value,
          22 + index,
        );
        assert.equal((await observe()).state.count, 22 + index);
        assert.equal(
          await frame.getByRole('button', { name: 'Рассказ', exact: true }).isVisible(),
          narrative,
        );
      }
      assert.deepEqual(
        await page.evaluate(() => messages.filter((message) => message.type === 'error')),
        [],
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  },
);
