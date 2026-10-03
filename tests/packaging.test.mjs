import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';
import { serve } from '../tools/site.mjs';

test('nested scene assets and data scripts survive building, serving and offline packaging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-package-'));
  const source = join(directory, 'source'),
    output = join(source, 'dist');
  let browser, server;
  try {
    for (const folder of ['pages', 'styles', 'assets', 'artifacts/review'])
      await mkdir(join(source, folder), { recursive: true });
    const put = (name, data) => writeFile(join(source, name), data);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2Y2cAAAAASUVORK5CYII=',
      'base64',
    );
    await put('assets/dot.png', png);
    await put('assets/model.glb', Buffer.from('glTF'));
    await put(
      'assets/device.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" class="ve-scene" viewBox="0 0 20 20"><title>Device</title><desc>Test device</desc><rect width="20" height="20" fill="red"/></svg>',
    );
    await put(
      'styles/scene.css',
      ':root{color-scheme:light dark}.ve-scene{color:light-dark(black,white);background-image:url(../assets/dot.png);--mask:url(#local)}',
    );
    await put(
      'entry.js',
      `import model from './assets/model.glb'; window.model = model; window.payload = JSON.parse(document.querySelector('#data').textContent); document.querySelector('.ve-scene').style.colorScheme = 'light';`,
    );
    await put(
      'pages/index.html',
      `<!doctype html><html><head><link rel="stylesheet" href='../styles/scene.css?v=1'></head><body>
      <main class="ve-scene"><img src='../assets/dot.png'><object data='../assets/device.svg' type='image/svg+xml' style='width:70px;height:90px'></object></main>
      <script id="data" type="application/json">{"answer":42}</script><script type='module' src='../entry.js'></script>
      </body></html>`,
    );
    await put('artifacts/review/index.html', '<p>Generated report</p>');
    await buildScene(source, output);
    await buildScene(source, output); // Never treat the prior build or its reports as source.
    assert.deepEqual(await readFile(join(output, 'assets/dot.png')), png);
    await assert.rejects(readFile(join(output, 'dist/pages/index.html')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(output, 'artifacts/review/index.html')), { code: 'ENOENT' });
    server = await serve(output);
    const response = await fetch(server.url + '/assets/dot.png');
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), png);

    const file = join(directory, 'offline.html');
    await writeFile(file, await packDirectory(output, 'pages/index.html', { theme: 'dark' }));
    browser = await chromium.launch();
    const context = await browser.newContext({ colorScheme: 'light', offline: true });
    const page = await context.newPage(),
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    assert.deepEqual(await page.evaluate(() => window.payload), { answer: 42 });
    assert(await page.evaluate(() => window.model.startsWith('data:')));
    const scene = await page.locator('.ve-scene').evaluate((element) => ({
      theme: getComputedStyle(element).colorScheme,
      image: getComputedStyle(element).backgroundImage,
      width: element.querySelector('img').naturalWidth,
    }));
    assert.equal(scene.theme, 'dark');
    assert(scene.image.includes('data:image/png'));
    assert.equal(scene.width, 1);
    const embedded = await page.locator('iframe').evaluate((frame) => ({
      theme: getComputedStyle(frame.contentDocument.querySelector('svg')).colorScheme,
      border: getComputedStyle(frame).borderWidth,
      width: frame.getBoundingClientRect().width,
      height: frame.getBoundingClientRect().height,
    }));
    assert.deepEqual(embedded, { theme: 'dark', border: '0px', width: 70, height: 90 });
    const svgFile = join(directory, 'svg.html');
    await writeFile(svgFile, await packDirectory(output, 'assets/device.svg', { theme: 'dark' }));
    await page.goto(pathToFileURL(svgFile).href);
    assert.equal(await page.locator('svg title').textContent(), 'Device');
    assert.equal(
      await page.locator('svg').evaluate((element) => getComputedStyle(element).colorScheme),
      'dark',
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
