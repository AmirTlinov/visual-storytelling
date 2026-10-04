import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { PNG } from 'pngjs';

test('public presentation preserves material paint, narrow layout, focused input and reversible state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'construction-presentation-'));
  let browser;
  try {
    await build({
      stdin: {
        resolveDir: process.cwd(),
        contents: `
      import { MathMorph, SceneShell, SketchControls, surface, paragraph } from './dist/index.js';
      import './dist/style.css';
      window.galleryReady = (async () => {
        await SceneShell.ready();
        const shell = SceneShell.mount(document.querySelector('main'), {title:'Механизм'});
        const drawing = await MathMorph.mount(shell.stage, MathMorph.integral('x^2',0,3));
        const field = SketchControls.field({type:'number',label:'Значение',value:2,min:-10,max:10,step:.1});
        document.querySelector('aside').append(field.element);
        const sheet = surface(document.querySelector('footer'), {id:'zero-paint',width:200,height:120,title:'Paint',description:'Zero to area',grid:false});
        const paint = sheet.pen.contour(sheet.layer,'area',[[20,20],[140,20],[140,20],[20,20]],{fill:'marker'});
        paint.element.style.color='blue';
        const lines = paragraph(sheet.layer, {size:20});
        lines.render('Первая строка\\nВторая строка',180,0,150);
        window.lab = {MathMorph,shell,drawing,field,paint,lines};
      })();`,
      },
      bundle: true,
      format: 'iife',
      outfile: join(directory, 'index.js'),
      loader: { '.woff2': 'dataurl' },
    });
    await writeFile(
      join(directory, 'index.html'),
      '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="index.css"><style>body{margin:0;background:white}main{width:355px}footer{width:200px}</style></head><body><main class="ve-scene"></main><aside></aside><footer></footer><script src="index.js"></script></body></html>',
    );
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 375, height: 850 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(pathToFileURL(join(directory, 'index.html')).href);
    await page.evaluate(() => window.galleryReady);
    const multiline = await page.evaluate(() => ({
      measured: lab.lines.bounds.height,
      drawn: lab.lines.element.getBBox().height,
    }));
    assert.ok(
      multiline.measured >= multiline.drawn && multiline.measured - multiline.drawn < 2,
      `wrapped bounds include each line offset once: ${JSON.stringify(multiline)}`,
    );
    const originalInput = page.getByRole('spinbutton', { name: 'Значение', exact: true });
    await originalInput.fill('');
    await originalInput.pressSequentially('-0');
    await page.evaluate(() => lab.field.describe({ label: 'Координата', format: (v) => `${v} м` }));
    assert.equal(await page.getByRole('spinbutton', { name: 'Координата' }).inputValue(), '-0');
    assert.equal(
      await page
        .getByRole('spinbutton', { name: 'Координата' })
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.getByRole('spinbutton', { name: 'Координата' }).pressSequentially('.5');
    assert.equal(await page.evaluate(() => lab.field.value), -0.5);
    await page.evaluate(() =>
      lab.paint.update([
        [20, 20],
        [140, 20],
        [140, 100],
        [20, 100],
      ]),
    );
    const paintImage = PNG.sync.read(await page.locator('footer svg').screenshot());
    const pixel = (60 * paintImage.width + 70) * 4;
    assert.ok(
      paintImage.data[pixel] < 250 && paintImage.data[pixel + 2] > paintImage.data[pixel] + 15,
      'a formerly zero-area region acquires its blue paint',
    );
    const result = await page.evaluate(async () => {
      const { MathMorph: M, drawing, shell } = lab;
      const state = () =>
        [...drawing.element.querySelectorAll('path')].map((el) => el.getAttribute('d')).join('|');
      const ops = [
        M.distribute(3, 2, 3),
        M.linear([
          [1, 0.8],
          [0, 1],
        ]),
        M.project(Math.PI / 3),
        M.derivative('x^2', 1.5),
        M.integral('sin(x)', 0, Math.PI),
        M.spring({ mass: 1, stiffness: 4, amplitude: 1 }),
        M.deform({
          domain: [
            [-1, -1],
            [1, 1],
          ],
          parameter: [0, 0.6],
          text: 'ФОРМА',
          map: ([x, y], p) => [x, y + p * x * x],
        }),
      ];
      let minScale = Infinity;
      for (const operation of ops) {
        drawing.setOperation(operation);
        drawing.render(0.57);
        const before = state();
        drawing.render(1);
        drawing.render(0);
        drawing.render(0.57);
        if (state() !== before) throw new Error('Reverse seek changed the material');
        const svg = drawing.element.querySelector('svg'),
          r = svg.getBoundingClientRect(),
          host = shell.stage.getBoundingClientRect();
        minScale = Math.min(minScale, r.width / svg.viewBox.baseVal.width);
        if (host.height + 1 < r.height) throw new Error('The drawing overflows its stage');
        for (const mark of svg.querySelectorAll('[role="img"]')) {
          const b = mark.getBoundingClientRect();
          if (b.width && (b.left < r.left - 2 || b.right > r.right + 2))
            throw new Error('A label overflows horizontally');
        }
      }
      const before = state();
      let rejected = false;
      try {
        drawing.setOperation(M.derivative('sqrt(x)', 0));
      } catch {
        rejected = true;
      }
      const atomic = rejected && state() === before;
      let invalidTime = false;
      try {
        drawing.render(NaN);
      } catch {
        invalidTime = true;
      }
      if (!invalidTime || state() !== before) throw new Error('Invalid time changed the drawing');
      document.querySelector('main').style.width = '345px';
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      drawing.setOperation(M.multiply(2, 3));
      drawing.render(0.4);
      const bodyPlan = drawing.plan,
        bodyElement = drawing.element.firstElementChild;
      const valid = M.plan(M.distribute(3, 2, 3));
      let failedMount = false;
      try {
        drawing.setOperation({
          ...valid,
          sample(p) {
            if (p > 0 && p < 0.02) throw new Error('Invalid annotation sample');
            return valid.sample(p);
          },
        });
      } catch {
        failedMount = true;
      }
      if (
        !failedMount ||
        drawing.plan !== bodyPlan ||
        drawing.element.firstElementChild !== bodyElement ||
        drawing.element.children.length !== 1
      )
        throw new Error('Failed replacement discarded the current presentation');
      drawing.render(0.5);
      drawing.setOperation(M.distribute(3, 2, 3));
      const retainedPlan = drawing.plan;
      drawing.render(0.61);
      const retainedPaths = state();
      let failedDrawing = false;
      try {
        drawing.setOperation({
          ...retainedPlan,
          sample(p) {
            const frame = retainedPlan.sample(p);
            return {
              ...frame,
              panels: frame.panels.map((panel) => ({
                ...panel,
                paths: [
                  {
                    id: 'invalid',
                    points: [
                      [NaN, 0],
                      [0, 1],
                    ],
                  },
                ],
              })),
            };
          },
        });
      } catch {
        failedDrawing = true;
      }
      if (!failedDrawing || drawing.plan !== retainedPlan || state() !== retainedPaths)
        throw new Error('Failed rendering published a broken construction');
      let failedBody = false;
      try {
        drawing.setOperation({
          ...bodyPlan,
          sample() {
            throw new Error('Invalid body sample');
          },
        });
      } catch {
        failedBody = true;
      }
      if (!failedBody || drawing.plan !== retainedPlan || drawing.element.children.length !== 1)
        throw new Error('Failed body mount discarded the construction');
      document.querySelector('main').style.width = '355px';
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      drawing.dispose();
      return { atomic, minScale, empty: shell.stage.children.length === 0 };
    });
    assert.equal(result.atomic, true);
    assert.equal(result.empty, true);
    assert.ok(result.minScale >= 0.99, 'narrow layouts retain the authored pen size in CSS pixels');
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
