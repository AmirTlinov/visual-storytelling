import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildScene } from '../tools/build-pages.mjs';
import { renderer } from '../tools/render.mjs';
const evidence = join(process.cwd(), 'artifacts/probability');
test(
  'normalization and seeded sample render their single trace and expose source limits',
  { timeout: 90000 },
  async () => {
    await mkdir(evidence, { recursive: true });
    for (const name of ['probability', 'sampling']) {
      const built = join(evidence, name + '-built');
      await buildScene(`tools/document-modules/${name}`, built, {
        sourcePackage: true,
        silent: true,
      });
      for (const [width, theme] of [
        [960, 'light'],
        [375, 'dark'],
      ]) {
        const r = await renderer({
          directory: built,
          width,
          theme,
          reduced: width === 375,
          controls: true,
        });
        try {
          for (const time of [0, 2.8, 6]) {
            await r.seek(time);
            const state = await r.capture.evaluate((scene) => scene.snapshot());
            if (name === 'probability')
              assert.ok(Math.abs(state.trace.totalProbability - 1) < 1e-14);
            else
              assert.equal(
                state.presented.successes,
                state.presented.draws.filter((draw) => draw.success).length,
              );
            await writeFile(join(evidence, `${name}-${width}-${time}.png`), await r.png());
          }
          await r.page.getByRole('button', { name: 'Условия', exact: true }).click();
          await r.page.locator('.ve-scene-resources > summary').click();
          assert.ok(await r.page.locator('.ve-scene-resources').isVisible());
          assert.equal(await r.page.locator('[data-resource-id]').count(), 2);
          await writeFile(
            join(evidence, `${name}-${width}-source.png`),
            await r.page.screenshot({ fullPage: true }),
          );
          await r.page.getByRole('button', { name: 'Закрыть условия', exact: true }).click();
          await r.control([
            { type: 'mode', value: 'explore' },
            { type: 'parameters', values: name === 'probability' ? { scoreA: 3 } : { seed: 0 } },
          ]);
          const changed = await r.capture.evaluate((scene) => scene.snapshot());
          const inspected = await r.page
            .locator('main')
            .evaluate((root) => root.scene.inspect({ presentation: false }));
          if (name === 'probability')
            assert.ok(changed.trace.probabilities[0] > changed.trace.probabilities[2]);
          else assert.equal(changed.sample.seed, 0);
          if (name === 'probability') {
            for (let i = 0; i < 3; i++) {
              const share = inspected.objects.find(
                (object) => object.id === `probability:probability:${i}`,
              );
              assert.equal(share.value, changed.trace.probabilities[i]);
              assert.equal(share.provenance.weight, changed.trace.weights[i]);
              assert.equal(share.provenance.totalWeight, changed.trace.totalWeight);
              assert.ok(share.visible);
            }
          } else {
            assert.equal(
              inspected.objects.find((object) => object.id === 'sampling:estimate').value,
              changed.presented.estimate,
            );
            assert.deepEqual(
              inspected.objects.find((object) => object.id === 'sampling:interval').value,
              changed.presented.interval,
            );
          }
          if (name === 'sampling') {
            assert.equal(
              await r.page
                .locator('[data-plot-label="x-tick"][data-layout-status="placed"]')
                .count(),
              2,
            );
            assert.equal(
              await r.page
                .locator('[data-plot-label="y-tick"][data-layout-status="placed"]')
                .count(),
              2,
            );
          }
          await r.control([{ type: 'undoExperiment' }]);
          const restored = await r.capture.evaluate((scene) => scene.snapshot());
          assert.equal(
            name === 'probability' ? restored.scoreA : restored.seed,
            name === 'probability' ? 0 : 42,
          );
          const accepted = await r.capture.evaluate((scene) => scene.snapshot());
          await assert.rejects(
            r.page.locator('main').evaluate((root) => {
              const doc = root.scene.authoring.document;
              doc.chapters[0].beats[0].text = 'Очень длинная подпись '.repeat(50);
              return root.scene.authoring.prepare(doc);
            }),
            /short/,
          );
          assert.deepEqual(await r.capture.evaluate((scene) => scene.snapshot()), accepted);
          const checkpoint = await r.page.locator('main').evaluate((root) => root.scene.capture());
          await r.seek(0);
          await r.page
            .locator('main')
            .evaluate((root, saved) => root.scene.restore(saved), checkpoint);
          assert.deepEqual(await r.capture.evaluate((scene) => scene.snapshot()), accepted);
          if (name === 'sampling') {
            await r.page.locator('main').evaluate(async (root) => {
              const doc = root.scene.authoring.document;
              doc.chapters[0].beats.at(-1).text = 'Одна выборка ещё может ошибаться.';
              await root.scene.authoring.replace(doc);
            });
            await r.seek(6);
            assert.equal(
              await r.page.locator('[aria-label="Одна выборка ещё может ошибаться."]').count(),
              1,
            );
            await writeFile(join(evidence, `sampling-${width}-narrative.png`), await r.png());
          }
          assert.deepEqual(
            r.messages.filter((message) => message.type === 'error'),
            [],
          );
        } finally {
          await r.close();
        }
      }
    }
  },
);
