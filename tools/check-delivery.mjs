import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from './site.mjs';
import { standalone, packDirectory } from './standalone.mjs';

await mkdir('artifacts', { recursive: true });
const consumer = await mkdtemp(join(tmpdir(), 'story-consumer-'));
let server, browser;
const run = (file, args, cwd = consumer) =>
  execFileSync(file, args, { cwd, stdio: 'pipe', maxBuffer: 16 * 1024 * 1024 });
try {
  run(process.execPath, [resolve('tools/scene.mjs'), 'new', consumer, '--example', 'area-story']);
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
  run('npm', ['run', 'build']);
  server = await serve(join(consumer, 'dist'));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url);
  await page.locator('[data-square]').first().waitFor({ state: 'attached' });
  await page.locator('[data-seek]').fill('48.2');
  await page.screenshot({ path: 'artifacts/consumer.png', fullPage: true });
  assert.equal(await page.locator('[data-square]').count(), 20);
  const offline = resolve('artifacts/offline-area.html');
  await writeFile(offline, await packDirectory(join(consumer, 'dist')));
  const compact = await packDirectory(join(consumer, 'dist'), 'index.html', { inline: true });
  assert(Buffer.byteLength(compact) <= 1_000_000);
  await writeFile('artifacts/inline-area.html', compact);
  await page.context().setOffline(true);
  for (const file of [offline, resolve('artifacts/inline-area.html')]) {
    await page.goto(pathToFileURL(file).href);
    await page.locator('[data-play]').waitFor();
    await page.locator('[data-play]').click();
    await page.waitForFunction(() => Number(document.querySelector('[data-seek]').value) > 0.15);
    await page.locator('[data-play]').click();
    await page.locator('[data-seek]').fill('48.2');
    await page.emulateMedia({ colorScheme: 'dark' });
    assert.equal(
      await page.locator('.ve-scene').evaluate((n) => getComputedStyle(n).backgroundColor),
      'rgba(0, 0, 0, 0)',
    );
  }
  const lc = resolve('artifacts/offline-lc.html');
  await writeFile(lc, await standalone('lc-oscillator'));
  await page.goto(pathToFileURL(lc).href);
  await page.waitForFunction(() => !document.querySelector('[data-seek]')?.disabled);
  await page.locator('[data-seek]').fill('0.75');
  assert(
    Math.abs(
      (await page
        .locator('iframe[data-scene-svg]')
        .evaluate((o) => o.contentDocument.querySelector('svg').getCurrentTime())) - 0.75,
    ) < 0.001,
  );
  await page.screenshot({ path: 'artifacts/offline-lc.png', fullPage: true });
  const three = resolve('artifacts/offline-3d.html');
  await writeFile(three, await standalone('explorer-3d'));
  await page.goto(pathToFileURL(three).href);
  await page.locator('canvas').waitFor();
  await page.locator('[data-mode=story]').click();
  await page.locator('[data-seek]').fill('15');
  assert.equal(await page.locator('canvas').evaluate((c) => c.width > 0 && c.height > 0), true);
  assert.deepEqual(errors, []);
  // The same consumer can disable narration without replacing the clock or scene code.
  await page.context().setOffline(false);
  const source = join(consumer, 'index.html');
  await writeFile(
    source,
    (await readFile(source, 'utf8')).replace('<audio ', '<audio data-silent="true" '),
  );
  run('npm', ['run', 'build']);
  await page.goto(server.url);
  await page.locator('[data-play]').waitFor();
  assert.equal(await page.locator('[data-mute]').count(), 0);
  await page.locator('[data-play]').click();
  await page.waitForFunction(() => Number(document.querySelector('[data-seek]').value) > 0.15);
  await page.locator('[data-play]').click();
  const report = {
    consumer: 'created, installed, built and rendered',
    offline: 'narration, compact HTML, LC native SVG seek and 3D work without network',
    inlineBytes: Buffer.byteLength(compact),
    silent: 'same clock/player, sound control hidden',
    errors,
  };
  await writeFile('artifacts/delivery.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await rm(consumer, { recursive: true, force: true });
}
