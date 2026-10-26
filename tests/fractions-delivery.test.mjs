import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildScene } from '../tools/build-pages.mjs';
import { renderer } from '../tools/render.mjs';
import { packDirectory } from '../tools/standalone.mjs';
const evidence = join(process.cwd(), 'artifacts/fractions');
test(
  'fractions share exact state with visible parts, both themes, compact input and reversible copy',
  { timeout: 90000 },
  async () => {
    const built = join(evidence, 'built');
    await mkdir(evidence, { recursive: true });
    await buildScene('tools/document-modules/fractions', built, {
      sourcePackage: true,
      silent: true,
    });
    const portable = join(evidence, 'portable');
    await mkdir(portable, { recursive: true });
    await writeFile(
      join(portable, 'index.html'),
      await packDirectory(built, 'index.html', { audio: 'original' }),
    );
    for (const [width, theme, reduced] of [
      [960, 'light', false],
      [375, 'dark', true],
    ]) {
      const r = await renderer({ directory: portable, width, theme, reduced, controls: true });
      try {
        for (const time of [0, 2, 4, 6]) {
          await r.seek(time);
          const state = await r.capture.evaluate((scene) => scene.snapshot());
          assert.deepEqual(state.total, { numerator: 5, denominator: 6 });
          const observed = await r.page.locator('main').evaluate((root) => root.scene.inspect());
          for (const part of state.parts) {
            const mark = observed.objects.find((object) => object.id === part.id);
            assert.deepEqual(mark.value, part.amount);
            assert.deepEqual(mark.provenance, part);
            assert.deepEqual(mark.inputs, part.inputs);
          }
          await writeFile(join(evidence, `${width}-${theme}-${time}.png`), await r.png());
        }
        const partId = (await r.capture.evaluate((scene) => scene.snapshot())).parts[0].id;
        await r.page.locator(`[data-object="${partId}"][role="button"]`).press('Enter');
        const checkpoint = await r.page.locator('main').evaluate((root) => root.scene.capture());
        assert.deepEqual(checkpoint.selected, [partId]);
        await r.seek(0);
        await r.capture.evaluate((scene, checkpoint) => scene.restore(checkpoint), checkpoint);
        assert.deepEqual(
          (await r.page.locator('main').evaluate((root) => root.scene.inspect())).selected,
          [partId],
        );
        const accepted = await r.capture.evaluate((scene) => scene.snapshot());
        await assert.rejects(
          r.page.locator('main').evaluate((root) => {
            const candidate = root.scene.authoring.document;
            candidate.chapters[0].beats.at(-1).text = 'Очень длинная подпись '.repeat(30);
            return root.scene.authoring.prepare(candidate);
          }),
          /one short line/,
        );
        assert.deepEqual(await r.capture.evaluate((scene) => scene.snapshot()), accepted);
        assert.equal(await r.page.locator('svg[visibility="hidden"]').count(), 0);
        await r.control([
          { type: 'mode', value: 'explore' },
          { type: 'parameters', values: { action: 'copy' } },
        ]);
        const copy = await r.capture.evaluate((scene) => scene.snapshot());
        assert.deepEqual(copy.total, { numerator: 4, denominator: 3 });
        assert.equal(copy.parts.filter((part) => part.copiedFrom).length, 3);
        await writeFile(join(evidence, `${width}-${theme}-copy.png`), await r.png());
        await r.control([{ type: 'undoExperiment' }]);
        assert.deepEqual((await r.capture.evaluate((scene) => scene.snapshot())).total, {
          numerator: 5,
          denominator: 6,
        });
        await r.control([{ type: 'parameters', values: { leftNumerator: 0, rightNumerator: 0 } }]);
        assert.equal((await r.capture.evaluate((scene) => scene.snapshot())).parts.length, 0);
        await r.control([
          {
            type: 'parameters',
            values: {
              leftNumerator: 1,
              leftDenominator: 1,
              rightNumerator: 1,
              rightDenominator: 1,
            },
          },
        ]);
        assert.deepEqual((await r.capture.evaluate((scene) => scene.snapshot())).total, {
          numerator: 2,
          denominator: 1,
        });
        await r.page.locator('main').evaluate((root) =>
          root.scene.authoring.replace(
            {
              recipe: 'fractions',
              id: 'sum',
              inputs: {
                leftNumerator: 1,
                leftDenominator: 2,
                rightNumerator: 1,
                rightDenominator: 3,
              },
            },
            { provisional: true },
          ),
        );
        await r.seek(6);
        const scoped = await r.page.locator('main').evaluate((root) => root.scene.inspect());
        assert.ok(scoped.snapshot.parts.every((part) => part.id.startsWith('sum:')));
        for (const root of scoped.snapshot.roots)
          assert.ok(
            scoped.objects.some(
              (object) =>
                object.id === root.id &&
                JSON.stringify(object.value) === JSON.stringify(root.amount),
            ),
          );
        assert.equal(await r.page.locator('[data-object^="fractions:"]').count(), 0);
        await r.page
          .locator('main')
          .evaluate((root) =>
            root.scene.authoring.replace(
              {
                recipe: 'fractions',
                id: 'empty',
                inputs: {
                  leftNumerator: 0,
                  leftDenominator: 2,
                  rightNumerator: 0,
                  rightDenominator: 3,
                },
              },
              { provisional: true },
            ),
          );
        await r.seek(6);
        await r.page
          .locator('main')
          .evaluate((root) =>
            root.scene.authoring.replace(
              {
                recipe: 'fractions',
                id: 'zero',
                inputs: {
                  leftNumerator: 0,
                  leftDenominator: 2,
                  rightNumerator: 0,
                  rightDenominator: 3,
                },
              },
              { provisional: true },
            ),
          );
        const zero = await r.page.locator('main').evaluate((root) => root.scene.inspect());
        assert.equal(zero.snapshot.parts.length, 0);
        assert.ok(
          zero.snapshot.roots.every((root) => zero.objects.some((object) => object.id === root.id)),
        );
        assert.equal(await r.page.locator('[data-object^="empty:"]').count(), 0);

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
