import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
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
  const skill = join(consumer, 'node_modules/@visual-storytelling/core/skill');
  for (const file of [
    join(skill, 'SKILL.md'),
    ...(await readdir(join(skill, 'references')))
      .filter((name) => name.endsWith('.md'))
      .map((name) => join(skill, 'references', name)),
  ]) {
    for (const [, link] of (await readFile(file, 'utf8')).matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:[a-z][\w+.-]*:|#)/i.test(link)) continue;
      await access(resolve(dirname(file), decodeURIComponent(link.split('#')[0])));
    }
  }
  await access(join(skill, '../tools/scene.mjs'));
  await writeFile(
    join(consumer, 'api.html'),
    `<!doctype html><html><head><meta charset="utf-8"></head><body><script type="module">
    import * as core from '@visual-storytelling/core';
    import * as ink from '@visual-storytelling/core/ink';
    import * as story from '@visual-storytelling/core/story';
    import * as controls from '@visual-storytelling/core/controls';
    import * as recipes from '@visual-storytelling/core/recipes';
    import * as output from '@visual-storytelling/core/export';
    import {Viewport3D} from '@visual-storytelling/core/three';
    window.publicAPI = [
      core.SketchMotion === ink.SketchMotion, typeof core.story === 'function' && core.story === story.story,
      core.PlayerControls === controls.PlayerControls, core.vector === recipes.vector,
      core.exportSVG === output.exportSVG, typeof Viewport3D.mount === 'function'
    ];
  </script></body></html>`,
  );
  run('npm', ['run', 'build']);
  const timing = JSON.parse(await readFile(join(consumer, 'timeline.json'), 'utf8'));
  const pictureTime = (timing.cues.product_result.end + 0.05).toFixed(2);
  run('npm', ['run', 'review', '--', '--cue', 'add_rows']);
  const review = JSON.parse(await readFile(join(consumer, 'artifacts/review/review.json'), 'utf8'));
  assert.deepEqual(review.warnings, []);
  assert.equal(review.cues[0].id, 'add_rows');
  assert.equal(review.cues[0].unchanged, false);
  server = await serve(join(consumer, 'dist'));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url + '/api.html');
  assert.deepEqual(await page.evaluate(() => window.publicAPI), Array(6).fill(true));
  assert.equal(await page.locator('link[rel="stylesheet"]').count(), 0);
  await page.goto(server.url);
  await page.locator('[data-square]').first().waitFor({ state: 'attached' });
  await page.locator('[data-seek]').fill(pictureTime);
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
    await page.locator('[data-seek]').fill(pictureTime);
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
    review: 'installed CLI captured a narrated operation with distinct intermediate frames',
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
