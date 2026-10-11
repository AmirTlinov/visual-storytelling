import { chromiumLaunchOptions } from './chromium.mjs';
import { mkdtemp, readFile, writeFile, rm, mkdir, readdir, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { serve } from './site.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidence = join(root, 'artifacts/delivery');
await mkdir(evidence, { recursive: true });
const workspace = await mkdtemp(join(tmpdir(), 'story-consumer-'));
const scaffold = join(workspace, 'scaffold'),
  consumer = join(workspace, 'gpt-model');
const execute = promisify(execFile);
const run = async (file, args, cwd = consumer) =>
  (await execute(file, args, { cwd, maxBuffer: 16 * 1024 * 1024 })).stdout;
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const install = (directory, offline = false) =>
  run(
    'npm',
    [
      'ci',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      ...(offline ? ['--offline'] : []),
    ],
    directory,
  );
const servers = [];
let browser;
try {
  console.log('Checking a production-only installed authoring package…');
  const neutral = JSON.parse(
    await run(
      process.execPath,
      [join(root, 'tools/scene.mjs'), 'new', scaffold, '--title', 'Новая тема', '--json'],
      workspace,
    ),
  );
  assert.equal(neutral.example, undefined);
  assert.equal(neutral.entry, 'index.html');
  assert.ok(neutral.files['scene.js']);
  assert.match(neutral.sourceRevision, /^[a-f0-9]{64}$/);
  await install(scaffold);
  const runtime = join(scaffold, 'node_modules/@visual-storytelling/core');
  const bootstrapCLI = join(runtime, 'tools/scene.mjs');
  const { projectFiles } = await import(
    pathToFileURL(join(runtime, 'tools/project-files.mjs')).href
  );
  assert.equal((await projectFiles(scaffold)).revision, neutral.sourceRevision);
  const installed = JSON.parse(
    await run(process.execPath, [bootstrapCLI, 'info', '--json'], scaffold),
  );
  assert.equal(installed.cli.status, 'packaged');
  assert.equal(installed.cli.build, neutral.runtime.build);
  assert.deepEqual(installed.issues, []);
  await assert.rejects(access(join(runtime, 'src')), { code: 'ENOENT' });
  await assert.rejects(access(join(runtime, 'tests')), { code: 'ENOENT' });
  const packed = JSON.parse(
    await run('npm', ['pack', '--dry-run', '--ignore-scripts', '--json'], runtime),
  )[0];
  const shipped = packed.files.map(({ path }) => path);
  assert.ok(shipped.includes('tools/scaffold/scene.js'));
  assert.ok(
    shipped
      .filter((path) => path.startsWith('examples/'))
      .every((path) => path === 'examples/catalog.json' || path.startsWith('examples/gpt-model/')),
  );
  assert.ok(!shipped.some((path) => path.startsWith('examples/') && /\.(wav|mp3|mp4)$/.test(path)));
  assert.ok(
    !shipped.some((path) =>
      /^examples\/.*\/(dist|site|artifacts|review|node_modules)\//.test(path),
    ),
  );
  const catalog = JSON.parse(
    await run(process.execPath, [bootstrapCLI, 'examples', '--json'], scaffold),
  );
  assert.deepEqual(
    catalog.map(({ id }) => id),
    ['gpt-model'],
  );
  for (const path of [catalog[0].source, catalog[0].preview, ...catalog[0].guides])
    await access(path);

  const signature = await run(process.execPath, [bootstrapCLI, 'api', 'Viewport3D'], scaffold);
  assert.match(signature, /@visual-storytelling\/core\/three/);
  assert.match(signature, /ShotTransition3D/);
  const batch = await run(
    process.execPath,
    [bootstrapCLI, 'api', 'surface', 'SurfaceOptions', 'object', 'lettering'],
    scaffold,
  );
  for (const name of ['surface', 'object', 'lettering'])
    assert.match(batch, new RegExp(`declare function ${name}\\(`));
  assert.equal([...batch.matchAll(/^Declaration:/gm)].length, 3);
  const api = await json(join(runtime, 'dist/api.json'));
  for (const file of new Set(Object.values(api.modules).flatMap(Object.values)))
    await access(join(runtime, 'dist', file));
  assert.match(
    await run(process.execPath, [bootstrapCLI, 'api', './story'], scaffold),
    /StoryOptions/,
  );
  await assert.rejects(
    run(process.execPath, [bootstrapCLI, 'api', 'surface', 'NoSuchPublicApiName'], scaffold),
    (error) => error.code === 1 && /No public symbol "NoSuchPublicApiName"/.test(error.stdout),
  );
  const skill = join(runtime, 'skills/visual-explainer');
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
  await writeFile(
    join(scaffold, 'api.html'),
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
  await run('npm', ['run', 'build'], scaffold);
  const neutralServer = await serve(join(scaffold, 'dist'));
  servers.push(neutralServer);
  browser = await chromium.launch(chromiumLaunchOptions());
  const page = await browser.newPage({ viewport: { width: 960, height: 800 } });
  const errors = [],
    externalOfflineRequests = [];
  let offline = false;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (offline && /^https?:/.test(request.url())) externalOfflineRequests.push(request.url());
  });
  await page.goto(neutralServer.url + '/api.html');
  assert.deepEqual(await page.evaluate(() => window.publicAPI), Array(10).fill(true));
  assert.equal(await page.locator('link[rel="stylesheet"]').count(), 0);
  await page.goto(neutralServer.url);
  await page.evaluate(() => window.galleryReady);
  assert.equal(
    await page.locator('.ve-scene').evaluate((node) => typeof node.scene.inspect),
    'function',
  );

  // The exemplar is copied by the installed CLI, without reading examples from this checkout.
  const created = JSON.parse(
    await run(
      process.execPath,
      [bootstrapCLI, 'new', consumer, '--example', 'gpt-model', '--json'],
      scaffold,
    ),
  );
  assert.equal(created.runtime.build, neutral.runtime.build);
  await install(consumer);
  const cli = join(consumer, 'node_modules/@visual-storytelling/core/tools/scene.mjs');
  await run(process.execPath, [cli, 'build', consumer]);
  const server = await serve(join(consumer, 'dist'));
  servers.push(server);
  await page.goto(server.url);
  await page.evaluate(() => window.galleryReady);
  const select = async (preset) =>
    page.evaluate(async (preset) => {
      const scene = document.querySelector('.ve-scene').scene;
      await scene.control([
        { type: 'parameters', values: { preset, view: 'output', checked: true } },
      ]);
      await scene.ready?.();
      const snapshot = scene.snapshot();
      return {
        preset: snapshot.preset,
        token: snapshot.trace.next.token,
        tokens: snapshot.trace.tokens,
      };
    }, preset);
  assert.equal((await select('cat-place')).token, 'ковре');
  assert.equal((await select('bird-place')).token, 'ветке');
  await page.screenshot({ path: join(evidence, 'consumer.png'), fullPage: true });

  const vectorViews = [
    'overview',
    'embedding',
    'block',
    'attention',
    'scores',
    'projection',
    'merge',
    'norm',
    'residual',
    'mlp',
    'output',
    'logits',
    'model',
  ];
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    for (const view of vectorViews) {
      const output = await page.evaluate(async (view) => {
        const scene = document.querySelector('.ve-scene').scene;
        await scene.control([
          { type: 'parameters', values: { view, perspective: 'diagram', checked: true } },
        ]);
        await scene.ready?.();
        const source = await scene.exportSVG();
        const svg = new DOMParser().parseFromString(source, 'image/svg+xml');
        const image = new Image(),
          url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
        try {
          image.src = url;
          await image.decode();
          const canvas = document.createElement('canvas');
          canvas.width = 640;
          canvas.height = 360;
          canvas.getContext('2d').drawImage(image, 0, 0, 640, 360);
          // A dormant HTML foreignObject must not taint a self-contained vector frame.
          canvas.toDataURL();
          return {
            source,
            view: scene.snapshot().view,
            errors: svg.querySelectorAll('parsererror,canvas,foreignObject').length,
          };
        } finally {
          URL.revokeObjectURL(url);
        }
      }, view);
      assert.equal(output.view, view);
      assert.equal(output.errors, 0, `${theme}/${view}: complete, decodable vector frame`);
      if (view === 'overview')
        await writeFile(join(evidence, `overview-${theme}.svg`), output.source);
    }
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.evaluate(async () => {
    const scene = document.querySelector('.ve-scene').scene;
    await scene.control([
      {
        type: 'parameters',
        values: { view: 'attention', perspective: 'algebra', kind: 'score', phase: 0.6 },
      },
    ]);
    await scene.ready?.();
  });
  assert.equal(
    await page
      .locator('canvas')
      .evaluateAll((nodes) => nodes.some((node) => node.checkVisibility())),
    true,
  );
  await assert.rejects(
    page.locator('.ve-scene').evaluate((node) => node.scene.exportSVG()),
    /complete frame.*PNG or HTML.*exportSVG/,
    'the actual Math3D layer needs a raster export',
  );
  const mathPNG = await page
    .locator('[data-scene-frame]')
    .screenshot({ path: join(evidence, 'math3d.png') });
  assert.ok((await sharp(mathPNG).stats()).channels.some(({ stdev }) => stdev > 5));

  console.log('Checking saved review evidence and offline interaction…');
  const reviewDirectory = join(evidence, 'review');
  const review = JSON.parse(
    await run(process.execPath, [
      cli,
      'review',
      join(consumer, 'dist'),
      '--from',
      '42',
      '--seconds',
      '.6',
      '--frames',
      '5',
      '--out',
      reviewDirectory,
    ]),
  );
  assert.equal(review.source.kind, 'scene-seek');
  for (const path of [review.path, review.image, review.framesImage, review.session])
    await access(path);
  const session = await json(review.session);
  assert.ok(session.episodes.some((episode) => episode.frames.length >= 3));
  const inspected = JSON.parse(
    await run(process.execPath, [cli, 'review', 'inspect', reviewDirectory, '--at', '42.3']),
  );
  assert.equal(inspected.session, session.id);
  const standalone = join(evidence, 'gpt-model.html');
  await run(process.execPath, [cli, 'pack', join(consumer, 'dist'), '--out', standalone]);
  offline = true;
  await page.context().setOffline(true);
  await page.goto(pathToFileURL(standalone).href);
  await page.evaluate(() => window.galleryReady);
  assert.equal((await select('bird-place')).token, 'ветке');
  await page.locator('[data-seek]').fill('0');
  await page.locator('[data-play]').click();
  await page.waitForFunction(() => Number(document.querySelector('[data-seek]').value) > 0.15);
  await page.locator('[data-play]').click();
  await page.locator('[data-seek]').fill('85');
  await page.emulateMedia({ colorScheme: 'dark' });
  assert.equal(
    await page.locator('.ve-scene').evaluate((node) => getComputedStyle(node).backgroundColor),
    'rgba(0, 0, 0, 0)',
  );
  await page.goto(pathToFileURL(review.path).href);
  const playback = page.locator('#motion-playback');
  await playback.evaluate((node) => {
    node.open = true;
  });
  const slider = playback.getByRole('spinbutton', { name: 'Перейти ко времени, секунды' });
  const end = Number(await slider.getAttribute('max'));
  await playback.locator('[data-play]').click();
  await page.waitForFunction(
    () => document.querySelector('#motion-playback [data-play]').textContent === 'Воспроизвести',
  );
  assert.ok(Math.abs(Number(await slider.inputValue()) - end) < 0.03);
  await playback.locator('[data-play]').click();
  await playback.evaluate((node) => {
    node.open = false;
  });
  await page.waitForFunction(
    () => document.querySelector('#motion-playback [data-play]').textContent === 'Воспроизвести',
  );
  assert.deepEqual(externalOfflineRequests, []);
  assert.deepEqual(errors, []);

  console.log('Checking PNG, SVG, video and a portable source release…');
  const release = join(evidence, 'release');
  await run(process.execPath, [
    cli,
    'deliver',
    consumer,
    '--out',
    release,
    '--formats',
    'html,png,svg,mp4,source',
    '--silent',
    '--from',
    '42',
    '--to',
    '43',
    '--width',
    '640',
    '--fps',
    '6',
    '--jobs',
    '1',
  ]);
  const delivery = await json(join(release, 'delivery.json'));
  assert.equal(delivery.runtime.build, created.runtime.build);
  assert.deepEqual(
    new Set(delivery.files),
    new Set(['story.html', 'story.png', 'story.svg', 'story.mp4', 'source.tar.gz']),
  );
  const png = await sharp(join(release, 'story.png')).metadata();
  const { renderer } = await import(
    pathToFileURL(join(consumer, 'node_modules/@visual-storytelling/core/tools/render.mjs')).href
  );
  // Still-image dimensions select the viewport; the image contains its composition.
  const still = await renderer({ directory: join(consumer, 'dist'), width: 640, height: 1200 });
  try {
    const presentation = await still.capture.evaluate((scene) => scene.presentation());
    assert.equal(presentation.outsideViewport, false);
    assert.deepEqual(presentation.clipped, []);
    assert.ok(Math.abs(presentation.frame.width / presentation.frame.height - 16 / 9) < 0.001);
    assert.ok(Math.abs(png.width - presentation.frame.width) <= 1);
    assert.ok(Math.abs(png.height - presentation.frame.height) <= 1);
    assert.equal(await still.page.locator('[data-scene-frame] [data-player]').count(), 0);
  } finally {
    await still.close();
  }
  assert.ok(
    (await sharp(join(release, 'story.png')).stats()).channels.some(({ stdev }) => stdev > 5),
  );
  assert.match(await readFile(join(release, 'story.svg'), 'utf8'), /<svg\b/);
  const video = JSON.parse(
    await run('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'stream=codec_type,width,height,nb_frames:format=duration',
      '-of',
      'json',
      join(release, 'story.mp4'),
    ]),
  );
  const picture = video.streams.find(({ codec_type }) => codec_type === 'video');
  assert.equal(picture.width, 640);
  assert.equal(picture.height, 360);
  assert.equal(Number(picture.nb_frames), 6);
  assert.ok(Math.abs(Number(video.format.duration) - 1) < 0.1);
  const restored = join(workspace, 'restored');
  await mkdir(restored);
  await run('tar', ['-xzf', join(release, 'source.tar.gz'), '-C', restored]);
  await install(join(restored, 'source'), true);
  await run('npm', ['run', 'build'], join(restored, 'source'));
  const restoredPackage = await json(join(restored, 'source/package.json'));
  assert.match(
    restoredPackage.dependencies['@visual-storytelling/core'],
    /^file:\.\/dependencies\/.*\.tgz$/,
  );
  await page.goto(pathToFileURL(join(release, 'story.html')).href);
  await page.evaluate(() => window.galleryReady);
  assert.equal((await select('cat-place')).token, 'ковре');
  assert.deepEqual(errors, []);
  assert.deepEqual(externalOfflineRequests, []);
  const report = {
    consumer: 'neutral scaffold → installed CLI → explicit GPT exemplar → build',
    runtime: created.runtime,
    runtimeBytes: packed.size,
    catalog: ['gpt-model'],
    publicAPI: 'root/subpath identity, installed declarations and skill links verified',
    offline:
      'standalone GPT preserves model inputs, playback and dark theme without network requests',
    review: 'installed CLI captures, inspects and replays saved frames offline',
    svg: {
      themes: ['light', 'dark'],
      views: vectorViews,
      math3d: 'PNG retains the visible GPU layer',
    },
    png: { width: png.width, height: png.height },
    video: {
      width: picture.width,
      height: picture.height,
      frames: Number(picture.nb_frames),
      seconds: Number(video.format.duration),
    },
    source: 'archive reinstalls offline and builds independently',
    errors,
  };
  await writeFile(join(evidence, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  for (const server of servers) await server.close();
  await rm(workspace, { recursive: true, force: true });
}
