import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { serve } from './site.mjs';
import { standalone } from './standalone.mjs';

await mkdir('artifacts', { recursive: true });
const receipt = JSON.parse(
  execFileSync('npm', ['pack', '--ignore-scripts', '--pack-destination', 'artifacts', '--json'], {
    encoding: 'utf8',
  }),
)[0];
const consumer = await mkdtemp(join(tmpdir(), 'story-consumer-'));
let server, browser;
try {
  await writeFile(
    join(consumer, 'package.json'),
    JSON.stringify({
      private: true,
      type: 'module',
      dependencies: {
        '@visual-storytelling/core': `file:${resolve('artifacts', receipt.filename)}`,
      },
    }),
  );
  execFileSync('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: consumer,
    stdio: 'pipe',
  });
  const readme = await readFile('README.md', 'utf8');
  const source = readme.match(/```ts\n([\s\S]*?)\n```/)[1];
  await writeFile(
    join(consumer, 'main.ts'),
    source + "\nexplanation.seek(4); document.body.dataset.ready='true';\n",
  );
  await writeFile(
    join(consumer, 'index.html'),
    '<!doctype html><html lang="ru"><meta charset="utf-8"><div id="app"></div><script type="module" src="./main.ts"></script></html>',
  );
  execFileSync(
    process.execPath,
    [
      resolve('node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--target',
      'ES2023',
      '--module',
      'ESNext',
      '--moduleResolution',
      'Bundler',
      'main.ts',
    ],
    { cwd: consumer, stdio: 'pipe' },
  );
  execFileSync(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'build'], {
    cwd: consumer,
    stdio: 'pipe',
  });
  server = await serve(join(consumer, 'dist'));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 700, height: 600 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url);
  await page.locator('body[data-ready=true]').waitFor();
  assert.equal(await page.locator('svg#square').count(), 1);
  await page.screenshot({ path: 'artifacts/consumer.png' });
  const offline = resolve('artifacts/area.html');
  await writeFile(offline, await standalone('area', 'light'));
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(offline).href);
  await page.evaluate(() => window.galleryReady);
  assert.equal(await page.locator('svg#area').count(), 1);
  await page.getByRole('button', { name: 'Воспроизвести', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('.vs-player input').value) > 2.1);
  await page.getByRole('button', { name: 'Пауза', exact: true }).click();
  await page.getByRole('slider', { name: 'Позиция рассказа' }).fill('48.2');
  await page.screenshot({ path: 'artifacts/offline.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        package: receipt.filename,
        size: receipt.size,
        consumer: 'built and rendered',
        offline: 'rendered and played narration without network',
      },
      null,
      2,
    ),
  );
} finally {
  await browser?.close();
  await server?.close();
  await rm(consumer, { recursive: true, force: true });
}
