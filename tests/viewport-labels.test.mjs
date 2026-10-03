import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { develop } from '../tools/dev.mjs';

test('3D annotations stay readable, attached and non-intercepting during orbit and pan', async () => {
  const source = await mkdtemp(join(tmpdir(), 'story-annotations-'));
  let server, browser;
  try {
    await writeFile(
      join(source, 'index.html'),
      '<!doctype html><html><head><meta charset="utf-8"></head><body class="ve-standalone"><main class="ve-scene"></main><script type="module" src="scene.js"></script></body></html>',
    );
    await writeFile(
      join(source, 'scene.js'),
      `
      import { SceneShell } from '@visual-storytelling/core';
      import { Viewport3D, ThreeKit as T } from '@visual-storytelling/core/three';
      import '@visual-storytelling/core/style.css';
      window.galleryReady = (async () => {
        await SceneShell.ready();
        const shell = SceneShell.mount(document.querySelector('main'), {title:'Annotations'});
        const view = Viewport3D.mount(shell.stage), group = new T.Group();
        const cube = new T.Mesh(new T.BoxGeometry(1,1,1), view.ink(new T.MeshBasicMaterial(), 'blue-wash'));
        const anchor = new T.Object3D(); anchor.position.y = 1.3;
        group.add(cube, anchor); view.setObject(group);
        view.shot({target: new T.Box3(new T.Vector3(-2,-2,-2), new T.Vector3(2,2,2)), direction:[0,0,1]});
        const number = view.label('−12.34', cube, {face:['front','back']});
        const formula = view.label('ReLU: x < 0 → 0', cube, {tone:'purple', side:'top', frame:{padding:[15,8]}});
        window.lab = {view, group, number, formula};
      })();
    `,
    );
    server = await develop(source, 0, { sourcePackage: true });
    browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 800, height: 650 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(server.url);
    await page.waitForFunction(() => window.lab);
    await page.evaluate(() => window.galleryReady);
    await page.evaluate(
      () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
    );
    const attachments = await page.evaluate(() =>
      lab.number.object.children.map((p) => ({ id: p.uuid, local: p.matrix.toArray() })),
    );
    for (const angle of [0, 0.7, 1.55, 2.3, Math.PI]) {
      await page.evaluate((a) => {
        lab.group.rotation.y = a;
        lab.view.invalidate();
      }, angle);
      await page.evaluate(
        () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))),
      );
      const result = await page.evaluate(() => {
        const text = lab.formula.element.getBoundingClientRect(),
          frame = lab.formula.element.parentElement.getBoundingClientRect();
        return {
          visible: !lab.formula.element.hidden && !lab.number.element.hidden,
          inside:
            text.left >= frame.left &&
            text.right <= frame.right &&
            text.top >= frame.top &&
            text.bottom <= frame.bottom,
          errors: document.querySelectorAll('[data-layout-error]').length,
          hit: document.elementFromPoint(frame.x + frame.width / 2, frame.y + frame.height / 2)
            ?.tagName,
        };
      });
      assert.deepEqual(result, { visible: angle !== 1.55, inside: true, errors: 0, hit: 'CANVAS' });
      assert.deepEqual(
        await page.evaluate(() =>
          lab.number.object.children.map((p) => ({ id: p.uuid, local: p.matrix.toArray() })),
        ),
        attachments,
      );
    }
    await page.evaluate(() => {
      lab.group.visible = false;
      lab.view.invalidate();
    });
    await page.waitForFunction(() => lab.formula.element.hidden && lab.number.element.hidden);
    await page.evaluate(() => {
      lab.group.visible = true;
      lab.view.invalidate();
    });
    const canvas = await page.locator('canvas').boundingBox();
    const start = [canvas.x + canvas.width / 2, canvas.y + canvas.height / 2];
    const initial = await page.evaluate(() => ({
      position: lab.view.camera.position.toArray(),
      target: lab.view.controls.target.toArray(),
    }));
    const poses = [];
    for (const button of ['middle', 'left']) {
      await page.evaluate((p) => {
        lab.view.camera.position.fromArray(p.position);
        lab.view.controls.target.fromArray(p.target);
        lab.view.controls.update();
      }, initial);
      if (button === 'left') await page.keyboard.down('Shift');
      await page.mouse.move(...start);
      await page.mouse.down({ button });
      await page.mouse.move(start[0] + 80, start[1] + 40, { steps: 8 });
      await page.mouse.up({ button });
      if (button === 'left') await page.keyboard.up('Shift');
      poses.push(
        await page.evaluate(() => ({
          position: lab.view.camera.position.toArray(),
          target: lab.view.controls.target.toArray(),
        })),
      );
    }
    assert.notDeepEqual(poses[0], initial);
    for (const key of ['position', 'target'])
      poses[0][key].forEach((v, i) => assert(Math.abs(v - poses[1][key][i]) < 1e-9));
    for (let i = 0; i < 3; i++)
      assert(
        Math.abs(
          poses[0].position[i] - poses[0].target[i] - (initial.position[i] - initial.target[i]),
        ) < 1e-9,
      );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server?.close();
    await rm(source, { recursive: true, force: true });
  }
});
