import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { assetURLs } from '../tools/asset-urls.mjs';

test('projected labels keep fixed annotations, inscriptions and protected objects readable after orbit and rewind', async () => {
  const [bundle, styles] = await Promise.all([
    build({
      stdin: {
        contents:
          "import { Viewport3D } from './src/viewport/three.ts'; import * as T from './src/viewport/engine.ts'; window.Kit = { Viewport3D, T };",
        resolveDir: resolve('.'),
      },
      bundle: true,
      write: false,
      format: 'iife',
      plugins: [assetURLs()],
      define: { 'import.meta.url': 'document.baseURI' },
    }),
    build({
      entryPoints: ['src/style.css'],
      bundle: true,
      write: false,
      loader: { '.woff2': 'dataurl', '.svg': 'dataurl' },
    }),
  ]);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1040, height: 720 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setContent(
      '<body class="ve-standalone"><main class="ve-scene" style="padding:0"><div id="stage" class="ve-stage" style="width:1200px;height:640px;transform:scale(.8);transform-origin:top left"></div></main></body>',
    );
    await page.addStyleTag({ content: styles.outputFiles[0].text });
    await page.evaluate(() => document.fonts.ready);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const { Viewport3D, T } = Kit;
      const stage = document.querySelector('#stage'),
        root = new T.Group();
      const protectedObject = new T.Mesh(
        new T.BoxGeometry(1.3, 1.3, 1.3),
        new T.MeshBasicMaterial(),
      );
      const view = Viewport3D.mount(stage, {
        labelInsets: () => ({ left: 28, right: 24, top: 32, bottom: 36 }),
        labelObstacles: () => [protectedObject],
      });
      protectedObject.material = view.ink(protectedObject.material, 'orange-wash');
      protectedObject.position.set(2.3, -0.8, 0);
      const cube = new T.Mesh(
        new T.BoxGeometry(1.4, 1.4, 1.4),
        view.ink(new T.MeshBasicMaterial(), 'blue-wash'),
      );
      root.add(cube, protectedObject);
      view.setObject(root, { fitView: false });
      view.describe(cube, 'measurement', { label: 'Измеряемый объём' });
      const inscription = view.label('120 м³', cube, { face: 'front', tone: 'blue' });
      const phrases = [
        'Внешнее давление изменяет форму предмета',
        'Площадь поверхности остаётся измеримой',
        'Число внутри относится к объёму материала',
      ];
      const labels = phrases.map((text, i) =>
        view.label(text, cube, {
          size: 24,
          tone: ['blue', 'purple', 'green'][i],
          frame: { padding: [10, 6] },
        }),
      );
      const fixedPoint = new T.Vector3(-3, 1.6, 0);
      const fixed = view.label('Опорная точка', () => fixedPoint, {
        avoidOverlap: false,
        size: 22,
      });
      const settle = () =>
        new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      const pose = async (angle, phase = 0) => {
        labels[0].set(phase ? 'Давление выросло вдвое' : phrases[0]);
        view.camera.position.set(9 * Math.sin(angle), 1.3, 9 * Math.cos(angle));
        view.camera.near = 0.01;
        view.camera.far = 100;
        view.camera.updateProjectionMatrix();
        view.controls.target.set(0, 0, 0);
        view.controls.update();
        view.invalidate();
        await settle();
      };
      const screen = (point) => {
        const p = point.clone().project(view.camera);
        return { x: ((p.x + 1) * stage.clientWidth) / 2, y: ((1 - p.y) * stage.clientHeight) / 2 };
      };
      const bounds = (object) => {
        object.geometry.computeBoundingBox();
        const { min, max } = object.geometry.boundingBox;
        const points = [];
        for (const x of [min.x, max.x])
          for (const y of [min.y, max.y])
            for (const z of [min.z, max.z])
              points.push(screen(object.localToWorld(new T.Vector3(x, y, z))));
        const x = Math.min(...points.map((p) => p.x)),
          y = Math.min(...points.map((p) => p.y));
        return {
          x,
          y,
          width: Math.max(...points.map((p) => p.x)) - x,
          height: Math.max(...points.map((p) => p.y)) - y,
        };
      };
      const snapshot = () => ({
        labels: [...stage.querySelectorAll('.ve-annotation')]
          .filter((el) => !el.hidden)
          .map((el) => ({
            text: el.textContent,
            x: parseFloat(el.style.left) - parseFloat(el.style.width) / 2,
            y: parseFloat(el.style.top) - parseFloat(el.style.height) / 2,
            width: parseFloat(el.style.width),
            height: parseFloat(el.style.height),
            status: el.dataset.layoutStatus,
          })),
        protected: [
          bounds(protectedObject),
          ...(!inscription.element.hidden ? [bounds(inscription.object.children[0])] : []),
        ],
        leaders: [...stage.querySelectorAll('.ve-annotation-leader')]
          .filter((el) => getComputedStyle(el).display !== 'none')
          .map((el) => el.querySelector('path').getAttribute('d')),
        area: { width: stage.clientWidth, height: stage.clientHeight },
        fixed: {
          expected: screen(fixedPoint),
          actual: {
            x: parseFloat(fixed.element.parentElement.style.left),
            y: parseFloat(fixed.element.parentElement.style.top),
          },
          hidden: fixed.element.hidden,
        },
      });
      window.lab = { stage, view, labels, fixed, pose, snapshot, settle };
    });
    const separated = (a, b) =>
      Math.max(
        a.x - b.x - b.width,
        b.x - a.x - a.width,
        a.y - b.y - b.height,
        b.y - a.y - a.height,
      ) >= 7.9;
    await page.evaluate(() => lab.pose(0));
    const initial = await page.evaluate(() => lab.snapshot());
    for (const [angle, phase] of [
      [0, 0],
      [0.75, 0],
      [-0.6, 1],
      [0, 0],
    ]) {
      await page.evaluate(([angle, phase]) => lab.pose(angle, phase), [angle, phase]);
      const current = await page.evaluate(() => lab.snapshot());
      assert.equal(current.labels.length, 4, JSON.stringify(current));
      for (const [i, a] of current.labels.entries()) {
        assert.equal(a.status, 'placed');
        assert(
          a.x >= 31.9 &&
            a.y >= 35.9 &&
            a.x + a.width <= current.area.width - 27.9 &&
            a.y + a.height <= current.area.height - 39.9,
        );
        for (const b of [...current.labels.slice(i + 1), ...current.protected])
          assert(separated(a, b), JSON.stringify({ a, b }));
      }
      assert(
        Math.hypot(
          current.fixed.actual.x - current.fixed.expected.x,
          current.fixed.actual.y - current.fixed.expected.y,
        ) < 0.01,
      );
      assert(
        current.leaders.length > 0,
        'displaced labels preserve a drawn connection to their object',
      );
      if (angle === 0 && phase === 0)
        assert.deepEqual(
          current,
          initial,
          'the same camera and condition reproduce the same labels and ink',
        );
    }
    await mkdir('artifacts/label-packing', { recursive: true });
    await page.locator('#stage').screenshot({ path: 'artifacts/label-packing/3d-light.png' });
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.evaluate(() => lab.settle());
    await page.locator('#stage').screenshot({ path: 'artifacts/label-packing/3d-dark.png' });
    await page.evaluate(async () => {
      lab.stage.style.width = '360px';
      lab.stage.style.height = '240px';
      await lab.settle();
      await lab.pose(0);
    });
    const trigger = page.locator('.ve-label-overflow');
    assert(await trigger.isVisible(), 'physically crowded labels have explicit access');
    await trigger.focus();
    await trigger.press('Enter');
    await page.waitForFunction(
      () => document.querySelector('.ve-label-overflow-list') === document.activeElement,
    );
    assert.match(
      await page.locator('.ve-label-overflow-list').innerText(),
      /давление|поверхности|объёму/,
    );
    await page.evaluate(async () => {
      lab.labels[0].set('Изменённое давление сохраняет доступность полного объяснения');
      await lab.settle();
    });
    assert(
      await page.locator('.ve-label-overflow-list').evaluate((el) => el === document.activeElement),
      'updating overflow preserves keyboard focus',
    );
    await page.keyboard.press('Escape');
    await page.waitForFunction(
      () => document.activeElement === document.querySelector('.ve-label-overflow'),
    );
    await page.locator('#stage').screenshot({ path: 'artifacts/label-packing/3d-crowded.png' });
    await page.evaluate(async () => {
      lab.stage.style.width = '1200px';
      lab.stage.style.height = '640px';
      await lab.settle();
      await lab.pose(0);
      lab.view.dispose();
    });
    assert.equal(
      await page
        .locator('.ve-label-overflow,.ve-label-overflow-list,.ve-annotation-leader')
        .count(),
      0,
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
});
