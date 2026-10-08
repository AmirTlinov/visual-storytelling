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
  run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  const runtime = join(consumer, 'node_modules/@visual-storytelling/core');
  const skill = resolve('skill');
  const cli = join(runtime, 'tools/scene.mjs');
  const installed = JSON.parse(run(process.execPath, [cli, 'info', '--json']).toString());
  assert.equal(installed.cli.status, 'packaged');
  for (const name of [
    'examples/catalog.json',
    'skills/visual-explainer/SKILL.md',
    'docs/lessons.md',
  ])
    await access(join(runtime, name));
  await assert.rejects(access(join(runtime, 'src')), { code: 'ENOENT' });
  const packed = JSON.parse(
    run('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], runtime),
  )[0];
  assert(
    !packed.files.some(({ path }) => path.startsWith('examples/') && /\.(wav|mp3|mp4)$/.test(path)),
    'Generated gallery media should not travel in the authoring package',
  );
  assert(
    !packed.files.some(({ path }) =>
      /^examples\/.*\/(dist|site|artifacts|review|node_modules)\//.test(path),
    ),
    'Generated example builds should not travel in the authoring package',
  );
  const signature = run(process.execPath, [cli, 'api', 'Viewport3D']).toString();
  assert.match(signature, /@visual-storytelling\/core\/three/);
  assert.match(signature, /ShotTransition3D/);
  const batch = run(process.execPath, [
    cli,
    'api',
    'surface',
    'SurfaceOptions',
    'object',
    'lettering',
  ]).toString();
  for (const name of ['surface', 'object', 'lettering'])
    assert.match(batch, new RegExp(`declare function ${name}\\(`));
  assert.equal([...batch.matchAll(/^Declaration:/gm)].length, 3);
  const api = JSON.parse(await readFile(join(runtime, 'dist/api.json'), 'utf8'));
  for (const file of new Set(Object.values(api.modules).flatMap(Object.values)))
    await access(join(runtime, 'dist', file));
  assert.match(run(process.execPath, [cli, 'api', './story']).toString(), /StoryOptions/);
  assert.throws(
    () => run(process.execPath, [cli, 'api', 'Viewport']),
    (error) => error.status === 1 && /Viewport3D/.test(error.stdout.toString()),
  );
  assert.throws(
    () => run(process.execPath, [cli, 'api', 'surface', 'Viewport']),
    (error) => error.status === 1 && /Viewport3D/.test(error.stdout.toString()),
  );
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
    import {IllustratedStory, documentNarration} from '@visual-storytelling/core/story';
    import {physicsChapter} from '@visual-storytelling/core/physics/2d';
    window.publicAPI = [
      core.SketchMotion === ink.SketchMotion, typeof core.story === 'function' && core.story === story.story,
      core.PlayerControls === controls.PlayerControls, core.vector === recipes.vector,
      core.exportSVG === output.exportSVG, typeof Viewport3D.mount === 'function',
      typeof IllustratedStory.mount === 'function', typeof physicsChapter === 'function',
      typeof documentNarration === 'function', typeof recipes.circuitDiagram === 'function'
    ];
  </script></body></html>`,
  );
  run('npm', ['run', 'build']);
  const timing = JSON.parse(await readFile(join(consumer, 'timeline.json'), 'utf8'));
  const pictureTime = (timing.cues.product_result.end + 0.05).toFixed(2);
  run('npm', ['run', 'review', '--', '--cue', 'add_rows']);
  const review = JSON.parse(
    await readFile(join(consumer, 'artifacts/review/session.json'), 'utf8'),
  );
  const action = review.episodes.find((e) => e.cue === 'add_rows');
  assert(action);
  assert.deepEqual(action.observations, []);
  assert(action.frames.length >= 3);
  server = await serve(join(consumer, 'dist'));
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 700, height: 900 } }),
    errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.url + '/api.html');
  assert.deepEqual(await page.evaluate(() => window.publicAPI), Array(10).fill(true));
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
  await page.goto(pathToFileURL(join(consumer, 'artifacts/review/index.html')).href);
  const episode = page.locator('[id="episode-cue:add_rows"]');
  await episode.evaluate((element) => (element.open = true));
  const transition = episode.locator('[data-evidence-range]');
  const end = Number((await transition.getAttribute('data-evidence-range')).split(',')[1]);
  await transition.click();
  const playback = page.locator('#motion-playback');
  await page.waitForFunction(
    () => document.querySelector('#motion-playback audio')?.paused === false,
  );
  await page.waitForFunction(
    () => document.querySelector('#motion-playback [data-play]').textContent === 'Воспроизвести',
  );
  assert(
    Math.abs((await playback.locator('audio').evaluate((audio) => audio.currentTime)) - end) < 0.03,
  );
  assert.equal(await playback.locator('audio').evaluate((audio) => audio.paused), true);
  await transition.click();
  await playback.evaluate((element) => (element.open = false));
  await page.waitForFunction(
    () => document.querySelector('#motion-playback audio')?.paused === true,
  );
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
  // The installed kit can author a new character story without this checkout or dev dependencies.
  await page.context().setOffline(false);
  const illustrated = join(consumer, 'illustrated');
  run(process.execPath, [cli, 'new', illustrated, '--example', 'tesla-circuit', '--silent']);
  run('npm', ['install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], illustrated);
  run('npm', ['run', 'build'], illustrated);
  const illustratedServer = await serve(join(illustrated, 'dist'));
  try {
    await page.goto(illustratedServer.url);
    await page.evaluate(() => window.galleryReady);
    const state = await page.evaluate(async () => {
      const scene = document.querySelector('#story').scene;
      await scene.control([{ type: 'cue', id: 'workshop.explain', progress: 0.8 }]);
      return scene.inspect();
    });
    assert.equal(state.snapshot.content.surfaces.board.visible, true);
    assert.deepEqual(state.presentation.clipped, []);
    assert.deepEqual(state.presentation.unreadableText, []);
    await page
      .getByRole('button', { name: 'Замкнуть или разомкнуть цепь' })
      .filter({ visible: true })
      .click();
    assert.equal(
      await page.evaluate(() => document.querySelector('#story').scene.inspect().mode),
      'explore',
    );
    assert.deepEqual(errors, []);
  } finally {
    await illustratedServer.close();
  }
  // A generated scene uses its installed library on every build, without source SVG copies.
  const generated = join(consumer, 'generated');
  await mkdir(generated);
  const { cp } = await import('node:fs/promises');
  await cp(resolve('examples/logic-gates'), generated, { recursive: true });
  run(process.execPath, [cli, 'build', generated]);
  await assert.rejects(access(join(generated, 'logic-gates.svg')), { code: 'ENOENT' });
  const generatedFile = join(generated, 'dist/logic-gates.svg');
  assert((await readFile(generatedFile, 'utf8')).includes('--ve-red-wash'));
  const ink = join(runtime, 'dist/styles/ink.css');
  await writeFile(ink, (await readFile(ink, 'utf8')) + '\n:root{--generation-probe:73}');
  run(process.execPath, [cli, 'build', generated]);
  assert((await readFile(generatedFile, 'utf8')).includes('--generation-probe:73'));
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
    runtimeBytes: packed.size,
    generation:
      'build regenerates SVG with the installed styles; the package includes its authoring catalog',
    review:
      'installed CLI stores a session and plays its frames with narration offline; episode end and close pause audio',
    offline: 'narration, compact HTML, LC native SVG seek and 3D work without network',
    inlineBytes: Buffer.byteLength(compact),
    silent: 'same clock/player, sound control hidden',
    authoring: 'installed production-only kit creates, builds and controls a new illustrated story',
    errors,
  };
  await writeFile('artifacts/delivery.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await server?.close();
  await rm(consumer, { recursive: true, force: true });
}
