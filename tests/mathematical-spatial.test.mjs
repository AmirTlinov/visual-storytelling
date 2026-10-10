import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

const scene = String.raw`
import { MathMorph, SceneShell } from './dist/index.js';
import './dist/style.css';
window.ready = (async () => {
  await SceneShell.ready();
  const bounds = [[-2,-2,-1],[2,2,1]];
  const rectangle = (x0,y0,x1,y1) => [[x0,y0,0],[x1,y0,0],[x1,y1,0],[x0,y1,0]];
  function plan(kind) {
    const m = MathMorph.model({fade:0});
    let objects;
    if (['material','z-up'].includes(kind)) objects = [m.material(([u,v]) => [u,v,.15*u*v], {
      domain:[[-1.2,-.9],[1.2,.9]], pigment:'blue', grid:[3,3],
    })];
    if (kind === 'point') objects = [m.point([.4,.3,.2], {pigment:'orange'})];
    if (kind === 'curve') objects = [m.curve(t => [t,.45*Math.sin(3*t),.2*t], {
      domain:[-1.4,1.4], pigment:'purple',
    })];
    if (kind === 'concave') objects = [m.polygon([
      [-1.5,-1.5,0],[1.5,-1.5,0],[1.5,1.5,0],[.5,1.5,0],
      [.5,-.5,0],[-.5,-.5,0],[-.5,1.5,0],[-1.5,1.5,0],
    ], {fill:true,pigment:'blue'})];
    if (kind === 'rectangles') objects = [
      rectangle(-1.5,-1.5,1.5,-.5), rectangle(-1.5,-.5,-.5,1.5), rectangle(.5,-.5,1.5,1.5),
    ].map(points => m.polygon(points,{fill:true,pigment:'blue'}));
    if (kind === 'labels') objects = [
      m.label('LOWER',[0,-.03,0]),
      m.label('UPPER',[0,.03,0],{visible:m.parameter('fade')}),
    ];
    if (['surface-ink','ink-only','hidden-ink'].includes(kind)) {
      const map = ([u,v]) => [u,v,.3*u*u + .2*v*v];
      objects = [m.curve(t => kind === 'hidden-ink' ? [t,.13,-.3] : map([t,.13]), {
        domain:[-1.2,1.2], pigment:'orange',
      })];
      if (kind !== 'ink-only') objects.unshift(m.material(map, {
        domain:[[-1.4,-.9],[1.4,.9]],pigment:'blue',
      }));
    }
    if (['growing-sheet','complete-sheet'].includes(kind)) objects = [m.material(
      ([u,v], {fade}) => { const size = kind === 'growing-sheet' ? fade : 1; return [size*u,0,size*v]; },
      {domain:[[-1.2,-.9],[1.2,.9]],pigment:'blue',text:'S',grid:[3,3]},
    )];
    return m.explain({
      panels:[{title:'Mathematics',space:'3d',bounds,objects,
        ...(kind === 'z-up' ? {camera:{direction:[3,-4,2],up:[0,0,1]}} : {}),
        ...(['surface-ink','ink-only','hidden-ink'].includes(kind) ? {camera:{direction:[0,0,1]}} : {})}],
      steps:[{to:{fade:1},explanation:''}],
    });
  }
  const reused = await MathMorph.mount(document.querySelector('#reused'), plan('material'));
  let fresh;
  window.lab = {
    reused,
    async replace(kind, reference=kind, progress=.4) {
      reused.setOperation(plan(kind));
      reused.render(progress);
      fresh?.dispose();
      fresh = await MathMorph.mount(document.querySelector('#fresh'), plan(reference));
      fresh.render(progress);
    },
    labels(progress) {
      if (progress === undefined) reused.setOperation(plan('labels'));
      else reused.render(progress);
    },
    dispose() { reused.dispose(); fresh?.dispose(); },
  };
})();`;

const settle = (page) =>
  page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
const image = async (page, id) => PNG.sync.read(await page.locator(`#${id} canvas`).screenshot());
const colored = (data, i) => Math.min(data[i], data[i + 1], data[i + 2]) < 240;

test('public 3D models replace subjects, preserve concavity and keep fading annotations stable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mathematical-spatial-'));
  let browser;
  try {
    await build({
      stdin: {
        contents: scene,
        resolveDir: fileURLToPath(new URL('../', import.meta.url)),
      },
      bundle: true,
      format: 'iife',
      outfile: join(directory, 'index.js'),
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <link rel="stylesheet" href="index.css">
      <style>body{margin:0;background:white;display:flex;gap:32px}main{width:420px;flex:none}</style>
      <main id="reused" class="ve-scene"></main><main id="fresh" class="ve-scene"></main>
      <script src="index.js"></script>`,
    );
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(pathToFileURL(join(directory, 'index.html')).href);
    await page.evaluate(() => window.ready);

    // A new mathematical model starts at object-0. Its final pixels must be independent
    // of which primitive occupied that identity in the previous operation.
    for (const kind of ['material', 'point', 'curve', 'material', 'point', 'material']) {
      await page.evaluate((kind) => lab.replace(kind), kind);
      await settle(page);
      const actual = await image(page, 'reused'),
        expected = await image(page, 'fresh');
      assert.equal(actual.width, expected.width);
      assert.equal(actual.height, expected.height);
      let ink = 0,
        changed = 0;
      for (let i = 0; i < actual.data.length; i += 4) {
        if (colored(actual.data, i) || colored(expected.data, i)) ink++;
        if ([0, 1, 2].some((c) => Math.abs(actual.data[i + c] - expected.data[i + c]) > 16))
          changed++;
      }
      assert.ok(ink > 8, `${kind} paints visible geometry`);
      assert.ok(
        changed <= Math.max(3, ink * 0.02),
        `${kind}: ${changed}/${ink} painted pixels differ from a fresh mount`,
      );
      assert.equal(await page.locator('#reused canvas').count(), 1);
    }

    // The U is the union of three rectangles. Comparing filled pixels checks the
    // concavity without prescribing the renderer's triangulation or camera.
    await page.evaluate(() => lab.replace('concave', 'rectangles'));
    await settle(page);
    const concave = await image(page, 'reused'),
      rectangles = await image(page, 'fresh');
    const blue = (data, i) => data[i + 2] > data[i] + 10 && data[i + 2] > data[i + 1] + 4;
    let intersection = 0,
      union = 0;
    for (let i = 0; i < concave.data.length; i += 4) {
      const a = blue(concave.data, i),
        b = blue(rectangles.data, i);
      if (a && b) intersection++;
      if (a || b) union++;
    }
    assert.ok(union > 1000, 'the comparison includes a visible filled region');
    assert.ok(
      intersection / union > 0.94,
      `concave fill agrees with its rectangular decomposition: ${intersection}/${union}`,
    );

    // A curve defined by the same surface map stays legible without an author-authored
    // z offset. A genuinely hidden path must still be covered by the surface.
    await page.evaluate(() => lab.replace('surface-ink', 'ink-only'));
    await settle(page);
    const orangePixels = (image) => {
      let count = 0;
      for (let i = 0; i < image.data.length; i += 4)
        if (image.data[i] > image.data[i + 2] * 1.3 && image.data[i] > image.data[i + 1] * 1.08)
          count++;
      return count;
    };
    const attached = orangePixels(await image(page, 'reused'));
    const floating = orangePixels(await image(page, 'fresh'));
    assert.ok(floating > 100, 'the reference stroke is comfortably readable');
    assert.ok(
      attached > floating * 0.9,
      `${attached}/${floating} ink pixels survive surface depth`,
    );
    await page.evaluate(() => lab.replace('hidden-ink'));
    await settle(page);
    assert.equal(
      orangePixels(await image(page, 'reused')),
      0,
      'the depth tolerance does not reveal hidden ink',
    );
    await page.evaluate(() => lab.replace('growing-sheet', 'complete-sheet', 1));
    await settle(page);
    const grown = await image(page, 'reused'),
      complete = await image(page, 'fresh');
    let cameraDifference = 0;
    for (let i = 0; i < grown.data.length; i += 4)
      if ([0, 1, 2].some((c) => Math.abs(grown.data[i + c] - complete.data[i + c]) > 16))
        cameraDifference++;
    assert.ok(
      cameraDifference < 10,
      'a collapsed opening cannot choose the wrong face of the eventual sheet',
    );

    await page.evaluate(() => lab.replace('z-up'));
    await settle(page);
    const camera = () =>
      page.locator('#reused canvas').evaluate((el) => el.__visualReview().camera.matrix);
    const initialCamera = await camera();
    await page.locator('#reused canvas').press('ArrowRight');
    await settle(page);
    const orbited = await camera();
    assert.ok(
      Math.abs(orbited[14] - initialCamera[14]) < 1e-7,
      'horizontal orbit preserves elevation along the authored Z-up axis',
    );
    assert.ok(
      Math.abs(orbited[12] - initialCamera[12]) > 0.01,
      'keyboard input rotates the camera',
    );
    await page.locator('#reused canvas').press('Home');
    await page.waitForFunction(
      (expected) =>
        document
          .querySelector('#reused canvas')
          .__visualReview()
          .camera.matrix.every((value, i) => Math.abs(value - expected[i]) < 1e-7),
      initialCamera,
    );
    assert.ok(
      (await camera()).every((v, i) => Math.abs(v - initialCamera[i]) < 1e-7),
      'Home restores the same authored view',
    );

    await page.evaluate(() => lab.labels());
    await settle(page);
    const labels = () =>
      page.evaluate(() =>
        Object.fromEntries(
          [...document.querySelectorAll('#reused .ve-label')].map((label) => {
            const group = label.parentElement,
              box = group.getBoundingClientRect();
            return [
              label.textContent,
              {
                x: box.x,
                y: box.y,
                width: box.width,
                height: box.height,
                opacity: Number(group.style.opacity),
              },
            ];
          }),
        ),
      );
    const hidden = await labels();
    await page.evaluate(() => lab.labels(0.101));
    await settle(page);
    const appearing = await labels();
    assert.equal(hidden.UPPER.opacity, 0);
    assert.ok(appearing.UPPER.opacity > 0 && appearing.UPPER.opacity < 0.01);
    for (const axis of ['x', 'y'])
      assert.ok(
        Math.abs(hidden.LOWER[axis] - appearing.LOWER[axis]) < 0.1,
        `a fading neighbour cannot move the visible label on ${axis}`,
      );
    await page.evaluate(() => lab.labels(1));
    await settle(page);
    const shown = await labels();
    assert.ok(
      shown.UPPER.y + shown.UPPER.height <= shown.LOWER.y,
      'vertical order follows the mathematical anchors, not insertion order',
    );
    await page.evaluate(() => lab.labels(0));
    await settle(page);
    assert.deepEqual(await labels(), hidden, 'reverse seek restores the same annotation layout');

    await page.evaluate(() => {
      lab.dispose();
      lab.dispose();
    });
    await page.setViewportSize({ width: 800, height: 700 });
    await settle(page);
    assert.equal(await page.locator('main canvas,main .ve-label,main svg').count(), 0);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
