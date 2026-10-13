import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { chromiumLaunchOptions } from '../tools/chromium.mjs';
import { assetURLs } from '../tools/asset-urls.mjs';

test('content-sized host grows after narrow resize and fullscreen still fits its viewport', async () => {
  const adapter = await build({
    entryPoints: ['plugin/ui/scene-frame.mjs'],
    bundle: true,
    write: false,
    format: 'iife',
  });
  const scene = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import {SceneShell} from './dist/index.js';import './dist/style.css';window.galleryReady=(async()=>{await SceneShell.ready();const shell=SceneShell.mount(document.querySelector('main'),{title:'Sizing',heading:false,parameters:[{key:'x',label:'X',value:3,min:0,max:10}]});shell.stage.textContent='A visible experiment';})();`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    outfile: 'frame.js',
    loader: { '.woff2': 'dataurl' },
    plugins: [assetURLs()],
  });
  const js = scene.outputFiles.find((f) => f.path.endsWith('.js')).text,
    css = scene.outputFiles.find((f) => f.path.endsWith('.css')).text;
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage({ viewport: { width: 375, height: 700 } });
    await page.setContent(
      '<body style="margin:0"><iframe style="display:block;border:0;width:100%;height:570px"></iframe>',
    );
    await page.evaluate((html) => {
      window.layouts = [];
      window.mode = 'inline';
      addEventListener('message', (event) => {
        if (event.data.type === 'layout') {
          layouts.push(event.data.height);
          if (mode !== 'fullscreen')
            document.querySelector('iframe').style.height = event.data.height + 'px';
        }
      });
      document.querySelector('iframe').srcdoc = html;
    }, `<!doctype html><html><head><style>${css}</style></head><body class="ve-standalone"><main class="ve-scene"></main><script>window.__visualStorySession={sessionId:'test',generation:1,stateRevision:0,displayMode:'inline'}</script><script>${js}</script><script>${adapter.outputFiles[0].text}</script></body></html>`);
    const frame = page.frameLocator('iframe');
    await page.waitForFunction(() => layouts.length > 0);
    const width = () =>
      frame.locator('[data-scene-frame]').evaluate((node) => node.getBoundingClientRect().width);
    assert.ok((await width()) < 375);
    await page.setViewportSize({ width: 960, height: 700 });
    await page.waitForFunction(
      () =>
        document
          .querySelector('iframe')
          .contentDocument.querySelector('[data-scene-frame]')
          .getBoundingClientRect().width > 800,
    );
    assert.ok((await width()) > 800);
    const inlineHeight = await page
      .locator('iframe')
      .evaluate((node) => node.getBoundingClientRect().height);
    assert.ok(inlineHeight > 400);
    await page.evaluate(() => {
      mode = 'fullscreen';
      const frame = document.querySelector('iframe');
      frame.style.height = '300px';
      frame.contentWindow.postMessage(
        {
          channel: 'visual-story-scene-v1',
          sessionId: 'test',
          generation: 1,
          type: 'host-layout',
          displayMode: mode,
        },
        '*',
      );
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('iframe')
          .contentDocument.querySelector('[data-scene-frame]')
          .getBoundingClientRect().width < 600,
    );
    assert.ok((await width()) < 600);
    await page.evaluate(() => {
      mode = 'inline';
      document.querySelector('iframe').contentWindow.postMessage(
        {
          channel: 'visual-story-scene-v1',
          sessionId: 'test',
          generation: 1,
          type: 'host-layout',
          displayMode: mode,
        },
        '*',
      );
    });
    await page.waitForFunction(
      () =>
        document
          .querySelector('iframe')
          .contentDocument.querySelector('[data-scene-frame]')
          .getBoundingClientRect().width > 800,
    );
    assert.ok((await width()) > 800);
    assert.equal(
      await frame
        .locator('main')
        .evaluate((root) => root.scene.inspect().parameters.find((p) => p.key === 'x').value),
      3,
    );
    assert.ok((await page.evaluate(() => layouts.length)) < 20, 'no sizing feedback loop');
  } finally {
    await browser.close();
  }
});

test('promoting an unchanged preview publishes its content height', async () => {
  const adapter = await build({
    entryPoints: ['plugin/ui/scene-frame.mjs'],
    bundle: true,
    write: false,
    format: 'iife',
  });
  const core = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import {SceneShell} from './dist/index.js';window.galleryReady=Promise.resolve().then(()=>{const root=document.querySelector('main');SceneShell.mount(root,{title:'Preview'});root.scene.extend({authoring:{replace:async()=>{}}});});`,
    },
    bundle: true,
    write: false,
    format: 'iife',
    plugins: [assetURLs()],
  });
  const browser = await chromium.launch(chromiumLaunchOptions());
  try {
    const page = await browser.newPage();
    await page.setContent('<iframe style="width:800px;height:570px"></iframe>');
    await page.evaluate((html) => {
      window.events = [];
      addEventListener('message', (event) => events.push(event.data));
      document.querySelector('iframe').srcdoc = html;
    }, `<!doctype html><html><body style="height:900px"><main class="ve-scene"></main><script>window.__visualStorySession={sessionId:'preview',generation:-1,stateRevision:0,preview:true,provisional:true,displayMode:'inline'}</script><script>${core.outputFiles[0].text}</script><script>${adapter.outputFiles[0].text}</script></body></html>`);
    await page.waitForFunction(() => events.some((event) => event.type === 'ready'));
    assert.equal(
      await page.evaluate(() => events.filter((event) => event.type === 'layout').length),
      0,
    );
    await page.evaluate(() =>
      document.querySelector('iframe').contentWindow.postMessage(
        {
          channel: 'visual-story-scene-v1',
          sessionId: 'preview',
          generation: -1,
          type: 'confirm-preview',
          document: {},
          nextSessionId: 'accepted',
          nextGeneration: 1,
          stateRevision: 0,
        },
        '*',
      ),
    );
    await page.waitForFunction(
      () => events.some((event) => event.type === 'layout' && event.sessionId === 'accepted'),
      {},
      { timeout: 3000 },
    );
    assert.ok(
      (await page.evaluate(() => events.find((event) => event.type === 'layout').height)) >= 900,
    );
  } finally {
    await browser.close();
  }
});
