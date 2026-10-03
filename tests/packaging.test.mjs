import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, cp, symlink, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';
import { serve } from '../tools/site.mjs';

test('CLI scene builds preserve the prior delivery on failure and remove stale assets on success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-scene-build-'));
  const source = join(directory, 'source');
  const cli = fileURLToPath(new URL('../tools/scene.mjs', import.meta.url));
  const run = (...args) => promisify(execFile)(process.execPath, [cli, 'build', source, ...args]);
  try {
    await mkdir(source);
    const html =
      '<!doctype html><html><head></head><body><script type="module">window.answer = 42;</script></body></html>';
    await writeFile(join(source, 'index.html'), html);
    await writeFile(join(source, 'old.json'), '{}');
    await run();
    const before = await readFile(join(source, 'dist/index.js'), 'utf8');
    await writeFile(
      join(source, 'index.html'),
      html.replace('window.answer = 42;', 'import "./missing.js";'),
    );
    await assert.rejects(run());
    assert.equal(await readFile(join(source, 'dist/index.js'), 'utf8'), before);
    await writeFile(join(source, 'index.html'), html);
    await rm(join(source, 'old.json'));
    await run();
    await assert.rejects(readFile(join(source, 'dist/old.json')), { code: 'ENOENT' });
    await assert.rejects(run('--out', directory), /must not contain scene sources/);
    await symlink(directory, join(directory, 'alias'), 'dir');
    await assert.rejects(
      promisify(execFile)(process.execPath, [
        cli,
        'build',
        join(directory, 'alias/source'),
        '--out',
        directory,
      ]),
      /must not contain scene sources/,
    );
    assert.equal(await readFile(join(source, 'index.html'), 'utf8'), html);
    assert.equal(
      (await readdir(source)).some((name) => name.startsWith('.visual-story-build-')),
      false,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('a failed package build preserves the last complete delivery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-package-build-'));
  const root = fileURLToPath(new URL('../', import.meta.url));
  const run = () =>
    promisify(execFile)(process.execPath, ['tools/build-package.mjs'], { cwd: directory });
  try {
    for (const folder of ['tools', 'src/assets', 'src/styles'])
      await mkdir(join(directory, folder), { recursive: true });
    for (const file of ['build-package.mjs', 'api.mjs', 'build-output.mjs'])
      await cp(join(root, 'tools', file), join(directory, 'tools', file));
    await symlink(join(root, 'node_modules'), join(directory, 'node_modules'), 'dir');
    const put = (name, data) => writeFile(join(directory, name), data);
    await put(
      'package.json',
      JSON.stringify({
        name: 'package-build-fixture',
        type: 'module',
        exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
      }),
    );
    await put(
      'tsconfig.build.json',
      JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          rootDir: 'src',
          outDir: 'dist',
          declaration: true,
          strict: true,
          types: [],
        },
        include: ['src'],
      }),
    );
    await put('src/index.ts', 'export const answer: number = 42;');
    await put('src/assets/voice.wav', 'source asset');
    await put('src/styles/theme.css', ':root { color: black; }');
    await put('src/style.css', '@import "./styles/theme.css";');
    await run();
    const files = [
      'index.js',
      'index.d.ts',
      'api.json',
      'style.css',
      'styles/theme.css',
      'assets/voice.wav',
    ];
    const before = await Promise.all(
      files.map((file) => readFile(join(directory, 'dist', file), 'utf8')),
    );
    assert.deepEqual(JSON.parse(before[2]).modules, { '.': { answer: 'index.d.ts' } });
    await put('src/index.ts', 'export const answer: number = "invalid";');
    await assert.rejects(run());
    assert.deepEqual(
      await Promise.all(files.map((file) => readFile(join(directory, 'dist', file), 'utf8'))),
      before,
    );
    assert.equal(
      (await readdir(directory)).some((name) => name.startsWith('.visual-story-build-')),
      false,
    );
    await put('dist/obsolete.js', 'old output');
    await put('src/index.ts', 'export const answer: number = 43;');
    await run();
    assert.match(await readFile(join(directory, 'dist/index.js'), 'utf8'), /43/);
    await assert.rejects(readFile(join(directory, 'dist/obsolete.js')), { code: 'ENOENT' });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('nested scene assets and data scripts survive building, serving and offline packaging', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'story-package-'));
  const source = join(directory, 'source'),
    output = join(source, 'dist');
  let browser, server;
  try {
    for (const folder of ['pages', 'styles', 'assets', 'artifacts/review'])
      await mkdir(join(source, folder), { recursive: true });
    const put = (name, data) => writeFile(join(source, name), data);
    await writeFile(
      join(directory, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { paths: { 'dx-value': ['./missing.ts'] } } }),
    );
    await mkdir(join(source, 'node_modules/dx-value'), { recursive: true });
    await put(
      'node_modules/dx-value/package.json',
      JSON.stringify({ name: 'dx-value', type: 'module', exports: './index.js' }),
    );
    await put('node_modules/dx-value/index.js', 'export default 42');
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
    await put('assets/device,alt.svg', await readFile(join(source, 'assets/device.svg')));
    await put(
      'assets/nested.svg',
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="device.svg" width="20" height="20"/></svg>',
    );
    await put('styles/imported.css', '.imported{background-image:url(../assets/nested.svg)}');
    await put(
      'styles/scene.css',
      '@import "./imported.css"; :root{color-scheme:light dark}.ve-scene{color:light-dark(black,white);background-image:url(../assets/dot.png);--mask:url(#local)}',
    );
    await put(
      'entry.js',
      `import expected from 'dx-value'; window.expected = expected; import model from './assets/model.glb'; window.model = model; window.payload = JSON.parse(document.querySelector('#data').textContent); document.querySelector('.ve-scene').style.colorScheme = 'light';`,
    );
    await put(
      'pages/index.html',
      `<!doctype html><html><head><link rel="stylesheet" href='../styles/scene.css?v=1'></head><body>
      <main class="ve-scene"><img src='../assets/dot.png'><picture><source media="(prefers-color-scheme:dark)" srcset="
        ../assets/device,alt.svg 1x,
        data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="red"/></svg>').toString('base64')} 2x
      "><img id="variant" src="../assets/dot.png"></picture><video poster=" ../assets/device.svg "></video><object data='../assets/device.svg' type='image/svg+xml' style='width:70px;height:90px'></object></main>
      <style>#inline-style{background-image:url('../assets/device.svg')}</style>
      <div id="inline-style" style="width:20px;height:20px"></div>
      <div id="attribute-style" style="width:20px;height:20px;background-image:url('../assets/device.svg')"></div>
      <div class="imported" style="width:20px;height:20px"></div>
      <svg id="inline-svg" xmlns="http://www.w3.org/2000/svg" width="20" height="20"><image href="../assets/nested.svg" width="20" height="20"/></svg>
      <script id="data" type="application/json">{"answer":42}</script><script type='module' src='../entry.js'></script>
      <audio data-silent="true" data-src="unused-narration.wav" src="unused-voice.wav"><source src="unused-music.mp3"></audio>
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
      errors = [],
      failed = [];
    page.on('requestfailed', (request) => failed.push(request.url()));
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(file).href);
    assert.deepEqual(await page.evaluate(() => window.payload), { answer: 42 });
    assert.equal(await page.evaluate(() => window.expected), 42);
    assert.equal(await page.locator('audio').getAttribute('data-silent'), 'true');
    assert.equal(await page.locator('audio').getAttribute('src'), null);
    assert.equal(await page.locator('audio').getAttribute('data-src'), null);
    assert.equal(await page.locator('audio source').count(), 0);
    assert(await page.evaluate(() => window.model.startsWith('data:')));
    const scene = await page.locator('.ve-scene').evaluate((element) => ({
      theme: getComputedStyle(element).colorScheme,
      image: getComputedStyle(element).backgroundImage,
      width: element.querySelector('img').naturalWidth,
    }));
    assert.equal(scene.theme, 'dark');
    assert(scene.image.includes('data:image/png'));
    assert.equal(scene.width, 1);
    for (const selector of ['#inline-style', '#attribute-style', '.imported'])
      assert(
        (
          await page.locator(selector).evaluate((e) => getComputedStyle(e).backgroundImage)
        ).includes('data:image/svg+xml'),
      );
    assert(
      (await page.locator('#inline-svg image').getAttribute('href')).startsWith(
        'data:image/svg+xml',
      ),
    );
    const { PNG } = await import('pngjs');
    for (const selector of ['#inline-style', '#attribute-style', '.imported', '#inline-svg']) {
      const picture = PNG.sync.read(await page.locator(selector).screenshot());
      const center =
        (Math.floor(picture.height / 2) * picture.width + Math.floor(picture.width / 2)) * 4;
      assert.deepEqual([...picture.data.subarray(center, center + 4)], [255, 0, 0, 255], selector);
    }
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(() => {
      const image = document.querySelector('#variant');
      return image.currentSrc.startsWith('data:image/svg+xml') && image.naturalWidth > 0;
    });
    assert(
      await page.locator('#variant').evaluate((image) => image.currentSrc.startsWith('data:')),
    );
    assert((await page.locator('video').getAttribute('poster')).startsWith('data:image/svg+xml'));
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
    assert.deepEqual(failed, []);
    await put('unsupported.html', '<svg><use href="assets/device.svg#shape"/></svg>');
    await assert.rejects(packDirectory(source, 'unsupported.html'), /Inline external SVG <use>/);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
