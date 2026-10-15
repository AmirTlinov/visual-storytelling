import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildScene } from '../tools/build-pages.mjs';
import { renderer } from '../tools/render.mjs';

async function readable(page) {
  return page.locator('main').evaluate((root) => {
    const visible = (node) =>
      node.checkVisibility({ visibilityProperty: true, opacityProperty: true });
    const buttons = [...root.querySelectorAll('svg .ve-svg-button[role="button"]')].filter(visible);
    const intersections = [];
    const overlap = (a, b) => {
      const x = a.getBoundingClientRect(),
        y = b.getBoundingClientRect();
      return (
        Math.min(x.right, y.right) - Math.max(x.left, y.left) > 0.5 &&
        Math.min(x.bottom, y.bottom) - Math.max(x.top, y.top) > 0.5
      );
    };
    for (let i = 0; i < buttons.length; i++)
      for (let j = i + 1; j < buttons.length; j++)
        if (overlap(buttons[i], buttons[j]))
          intersections.push([
            buttons[i].getAttribute('aria-label'),
            buttons[j].getAttribute('aria-label'),
          ]);
    const labels = [...root.querySelectorAll('.vs-lettering')].filter(
      (node) =>
        visible(node) &&
        /^(Удерживаем|[\d,]+ с|Старт:|Тяни груз)/.test(node.getAttribute('aria-label') || ''),
    );
    for (const label of labels)
      for (const button of buttons)
        if (overlap(label, button))
          intersections.push([label.getAttribute('aria-label'), button.getAttribute('aria-label')]);
    return { intersections, buttons: buttons.length, presentation: root.scene.presentation() };
  });
}

test(
  'the lever moves, accepts real drags and keys, and preserves one scene and one undo per gesture',
  { timeout: 90000 },
  async () => {
    const evidence = join(process.cwd(), 'artifacts/lever'),
      built = join(evidence, 'built');
    await mkdir(evidence, { recursive: true });
    await buildScene('tools/document-modules/lever', built, { sourcePackage: true, silent: true });
    for (const [width, theme] of [
      [960, 'light'],
      [390, 'dark'],
    ]) {
      const r = await renderer({ directory: built, width, theme, controls: true });
      try {
        const snapshot = () => r.capture.evaluate((scene) => scene.snapshot());
        await r.page.locator('main').evaluate(async (root) => {
          const doc = root.scene.authoring.document;
          doc.chapters[0].beats[0].text = 'Перекладина отпускается.';
          await root.scene.authoring.replace(doc);
        });
        await r.page.locator('main').evaluate((root) => {
          window.acceptedLeverHandle = root.scene;
          window.acceptedLeverRod = root.querySelector('[data-object="lever:rod"]');
        });
        const start = await snapshot();
        assert.equal(start.motion.angle, 0);
        for (const time of [0.15, 0.3, 2]) {
          await r.seek(time);
          const state = await snapshot();
          assert(state.motion.angle > 0);
          const observed = await r.page
            .locator('[data-object="lever:rod"]')
            .evaluate((node) => ({ b: node.transform.baseVal.consolidate().matrix.b }));
          assert(Math.abs(observed.b + Math.sin(state.motion.angle)) < 1e-6);
          assert.equal(
            await r.page
              .locator('main')
              .evaluate(
                (root) =>
                  root.scene === window.acceptedLeverHandle &&
                  root.querySelector('[data-object="lever:rod"]') === window.acceptedLeverRod,
              ),
            true,
          );
          await writeFile(join(evidence, `${width}-${theme}-${time}.png`), await r.png());
        }
        await r.seek(0);
        const slider = r.page.getByRole('slider', {
          name: 'Правый груз: расстояние от оси',
          exact: true,
        });
        const bounds = await slider.boundingBox();
        assert(bounds.width >= 44 && bounds.height >= 44);
        const delta = await slider.evaluate((node) => {
          const canvas = node.ownerSVGElement;
          return canvas.viewBox.baseVal.width * 0.38 * 0.2 * canvas.getScreenCTM().a;
        });
        await r.page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await r.page.mouse.down();
        await r.page.mouse.move(bounds.x + bounds.width / 2 + delta, bounds.y + bounds.height / 2, {
          steps: 8,
        });
        await r.page.waitForFunction(
          () => document.querySelector('main').scene.snapshot().rightArm === 40,
        );
        assert.equal(
          (await snapshot()).motion.angle,
          0,
          'the pointer holds the new trial horizontally',
        );
        await r.page.mouse.up();
        await r.page.waitForFunction(() => document.querySelector('main').scene.inspect().playing);
        await r.control([{ type: 'pause' }]);
        assert.equal((await snapshot()).equilibrium, true);
        await r.control([{ type: 'undoExperiment' }]);
        assert.equal((await snapshot()).rightArm, 20, 'one undo reverses all eight drag moves');
        await r.control([{ type: 'redoExperiment' }]);
        assert.equal((await snapshot()).rightArm, 40);
        await slider.focus();
        await r.page.keyboard.down('ArrowRight');
        await r.page.keyboard.down('ArrowRight');
        await r.page.keyboard.down('ArrowRight');
        await r.page.keyboard.up('ArrowRight');
        await r.page.waitForFunction(
          () => document.querySelector('main').scene.snapshot().rightArm === 43,
        );
        await r.control([{ type: 'pause' }]);
        assert.equal(
          await slider.evaluate((node) => node === document.activeElement),
          true,
          'input retains the same focused grip',
        );
        await r.control([{ type: 'undoExperiment' }]);
        assert.equal((await snapshot()).rightArm, 40, 'held keys are one gesture');
        await r.page
          .getByRole('button', { name: 'Справа: увеличить силу на 1 Н', exact: true })
          .click();
        await r.page.waitForFunction(
          () => document.querySelector('main').scene.snapshot().rightForce === 4,
        );
        await r.control([{ type: 'pause' }]);
        await r.seek(1.2);
        assert(
          (await snapshot()).motion.angle < 0,
          'the changed weight reverses the visible rotation',
        );
        const acceptedTime = (await snapshot()).time;
        const checkpoint = await r.page.locator('main').evaluate((root) => root.scene.capture());
        await r.control([{ type: 'parameters', values: { rightArm: 60, rightForce: 2 } }]);
        assert.equal((await snapshot()).motion.angle, 0);
        assert.equal((await snapshot()).equilibrium, true);
        await r.capture.evaluate((scene, value) => scene.restore(value), checkpoint);
        assert.equal((await snapshot()).time, acceptedTime);
        assert.equal((await snapshot()).rightForce, 4);
        await writeFile(join(evidence, `${width}-${theme}-interaction.png`), await r.png());
        const layout = await readable(r.page);
        assert.equal(layout.buttons, 4);
        assert.deepEqual(layout.intersections, []);
        assert.deepEqual(layout.presentation.clipped, []);
        assert.deepEqual(layout.presentation.unreadableText, []);
        assert.deepEqual(
          r.messages.filter((message) => message.type === 'error'),
          [],
        );
      } finally {
        await r.close();
      }
    }
  },
);

test(
  'static, reduced, replay cancellation, extreme inputs and disposal retain the same owners',
  { timeout: 90000 },
  async () => {
    const evidence = join(process.cwd(), 'artifacts/lever'),
      built = join(evidence, 'built');
    const r = await renderer({
      directory: built,
      width: 390,
      theme: 'dark',
      reduced: true,
      controls: true,
    });
    try {
      const snapshot = () => r.capture.evaluate((scene) => scene.snapshot());
      await r.page.locator('main').evaluate((root) => {
        window.leverPlaybackErrors = [];
        root.addEventListener('scene-playback-error', (event) =>
          window.leverPlaybackErrors.push(String(event.detail)),
        );
      });
      assert.equal((await snapshot()).time, 0);
      await r.seek(3);
      assert.equal((await snapshot()).time, 1);
      await r.control([
        {
          type: 'parameters',
          values: { leftForce: 100, rightForce: 100, leftArm: 0, rightArm: 0 },
        },
      ]);
      assert.equal((await snapshot()).time, 0);
      let layout = await readable(r.page);
      assert.deepEqual(layout.intersections, []);
      assert.deepEqual(layout.presentation.clipped, []);
      const sliders = await r.page.getByRole('slider', { name: /груз: расстояние/ }).all();
      const [left, right] = await Promise.all(sliders.map((slider) => slider.boundingBox()));
      assert(
        left.x + left.width < right.x,
        'coincident application points retain two separate grips',
      );
      await writeFile(join(evidence, '390-zero.png'), await r.png());
      await r.control([{ type: 'parameters', values: { leftArm: 100, rightArm: 99 } }]);
      await r.seek(6);
      layout = await readable(r.page);
      assert.deepEqual(layout.intersections, []);
      assert.deepEqual(layout.presentation.clipped, []);
      assert.deepEqual(layout.presentation.unreadableText, []);
      await writeFile(join(evidence, '390-extreme.png'), await r.png());
      await r.control([
        { type: 'parameters', values: { leftArm: 70, rightArm: 0, rightForce: 0 } },
      ]);
      await r.seek(6);
      layout = await readable(r.page);
      assert.deepEqual(layout.intersections, []);
      assert.deepEqual(layout.presentation.clipped, []);
      assert.deepEqual(layout.presentation.unreadableText, []);
      await writeFile(join(evidence, '390-full-turn.png'), await r.png());
      await r.control([{ type: 'parameters', values: { rightForce: 100 } }]);
      const document = await r.page
        .locator('main')
        .evaluate((root) => root.scene.authoring.document);
      await r.page.locator('main').evaluate(async (root, doc) => {
        await root.scene.authoring.replace({ ...doc, chapters: [] });
      }, document);
      assert.equal(
        await r.page.getByRole('button', { name: 'Воспроизвести', exact: true }).count(),
        0,
      );
      await r.page.getByRole('button', { name: 'Справа: уменьшить силу на 1 Н' }).click();
      assert.equal((await snapshot()).rightForce, 99);
      assert.equal((await snapshot()).time, 2);
      await r.page.locator('main').evaluate(async (root, doc) => {
        await root.scene.authoring.replace(doc);
      }, document);
      assert.equal(
        await r.page.getByRole('button', { name: 'Воспроизвести', exact: true }).count(),
        1,
      );
      await r.page.locator('main').evaluate((root) => {
        window.detachLeverHost = root.scene.connectHost({
          beforePlay({ signal }) {
            window.leverPlaySignal = signal;
            return new Promise((resolve) => {
              window.releaseLeverReady = resolve;
            });
          },
        });
      });
      await r.page.getByRole('button', { name: 'Справа: уменьшить силу на 1 Н' }).click();
      await r.page.waitForFunction(() => Boolean(window.releaseLeverReady));
      await r.control([{ type: 'pause' }]);
      assert.equal(await r.page.evaluate(() => window.leverPlaySignal.aborted), true);
      await r.page.evaluate(() => {
        window.releaseLeverReady();
        window.releaseLeverReady = undefined;
      });
      await r.page.waitForTimeout(30);
      assert.equal(
        await r.page.locator('main').evaluate((root) => root.scene.inspect().playing),
        false,
      );
      await r.page.getByRole('button', { name: 'Справа: уменьшить силу на 1 Н' }).click();
      await r.page.waitForFunction(() => Boolean(window.releaseLeverReady));
      await r.control([{ type: 'parameters', values: { rightArm: 60 } }]);
      assert.equal(await r.page.evaluate(() => window.leverPlaySignal.aborted), true);
      await r.page.evaluate(() => {
        window.releaseLeverReady();
        window.releaseLeverReady = undefined;
      });
      await r.page.waitForTimeout(30);
      assert.equal(
        await r.page.locator('main').evaluate((root) => root.scene.inspect().playing),
        false,
      );
      assert.equal((await snapshot()).time, 0, 'API input holds the new trial from rest');
      await r.page.getByRole('button', { name: 'Справа: уменьшить силу на 1 Н' }).click();
      await r.page.waitForFunction(() => Boolean(window.releaseLeverReady));
      const slider = r.page.getByRole('slider', {
        name: 'Правый груз: расстояние от оси',
        exact: true,
      });
      const box = await slider.boundingBox();
      await r.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await r.page.mouse.down();
      await r.page.evaluate(() => {
        window.releaseLeverReady();
      });
      await r.page.waitForTimeout(50);
      assert.equal(
        await r.page.locator('main').evaluate((root) => root.scene.inspect().playing),
        false,
        'a cancelled replay cannot resume a new hold',
      );
      await r.page.mouse.move(box.x + box.width / 2 - 10, box.y + box.height / 2, { steps: 3 });
      await r.page.locator('main').evaluate((root) => root.scene.dispose());
      await r.page.mouse.up();
      assert.deepEqual(await r.page.evaluate(() => window.leverPlaybackErrors), []);
      assert.deepEqual(
        r.messages.filter((message) => message.type === 'error'),
        [],
      );
    } finally {
      await r.close();
    }
  },
);
