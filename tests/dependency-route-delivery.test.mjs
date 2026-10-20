import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildScene } from '../tools/build-pages.mjs';
import { packDirectory } from '../tools/standalone.mjs';
import { renderer } from '../tools/render.mjs';
const evidence = join(process.cwd(), 'artifacts/dependency-route');
test(
  'route, visible packet, manual conditions and standalone reopening agree at desktop and narrow widths',
  { timeout: 120000 },
  async () => {
    const built = join(evidence, 'built'),
      portable = join(evidence, 'portable');
    await buildScene(join(process.cwd(), 'tests/fixtures/dependency-route'), built, {
      sourcePackage: true,
      silent: true,
    });
    await mkdir(portable, { recursive: true });
    await writeFile(
      join(portable, 'index.html'),
      await packDirectory(built, 'index.html', { audio: 'original' }),
    );
    for (const [width, theme, reduced] of [
      [960, 'light', false],
      [375, 'dark', true],
    ]) {
      const render = await renderer({ directory: portable, width, theme, reduced, controls: true });
      try {
        await render.seek(6);
        const before = await render.capture.evaluate((scene) => scene.snapshot());
        assert.equal(before.status, 'blocked');
        assert.equal(before.blocked, 'provider');
        assert.equal(
          await render.page.locator('[data-object="route:order:417"]').getAttribute('data-status'),
          'blocked',
        );
        await writeFile(join(evidence, `shared-${width}-${theme}.png`), await render.png());
        await render.control([
          { type: 'mode', value: 'explore' },
          { type: 'parameters', values: { reserve: 'independent' } },
        ]);
        const after = await render.capture.evaluate((scene) => scene.snapshot());
        assert.equal(after.status, 'delivered');
        assert.equal(after.orderId, '417');
        assert.deepEqual(after.route, ['shop', 'backup', 'independent', 'bank']);
        await writeFile(join(evidence, `independent-${width}-${theme}.png`), await render.png());
        const bounds = await render.page.locator('[data-object="route:order:417"]').boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, JSON.stringify(bounds));
        assert.equal(await render.page.locator('[data-layout-error]').count(), 0);
        await render.capture.evaluate(async (scene) => {
          await document.querySelector('.ve-scene').scene.undoExperiment();
        });
        assert.equal(
          (await render.capture.evaluate((scene) => scene.snapshot())).status,
          'blocked',
        );
        await render.capture.evaluate(async (scene) => {
          await document.querySelector('.ve-scene').scene.redoExperiment();
        });
        assert.equal(
          (await render.capture.evaluate((scene) => scene.snapshot())).status,
          'delivered',
        );
        await render.seek(0);
        await render.seek(6);
        assert.equal((await render.capture.evaluate((scene) => scene.snapshot())).orderId, '417');
        await render.page.setViewportSize({ width: 1, height: 1 });
        await render.page.waitForTimeout(100);
        await render.page.setViewportSize({ width: Number(width), height: 800 });
        await render.page.waitForTimeout(100);
        assert.equal(
          (await render.capture.evaluate((scene) => scene.snapshot())).status,
          'delivered',
        );
        assert.equal(await render.page.locator('[data-layout-error]').count(), 0);
        assert.deepEqual(
          render.messages.filter((message) => message.type === 'error'),
          [],
        );
      } finally {
        await render.close();
      }
    }
  },
);
