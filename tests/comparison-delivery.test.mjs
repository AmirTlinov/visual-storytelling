import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildScene } from '../tools/build-pages.mjs';
import { renderer } from '../tools/render.mjs';
const evidence = join(process.cwd(), 'artifacts/comparison');
test(
  'one comparison viewport presents exact lever and route cases at one shared scale',
  { timeout: 90000 },
  async () => {
    await mkdir(evidence, { recursive: true });
    for (const kind of ['lever', 'route']) {
      const built = join(evidence, kind + '-built');
      await buildScene(`tools/document-modules/${kind}-comparison`, built, {
        sourcePackage: true,
        silent: true,
      });
      for (const [width, theme, reduced] of [
        [960, 'light', false],
        [375, 'dark', true],
      ]) {
        const r = await renderer({ directory: built, width, theme, reduced, controls: true });
        try {
          const captions = ['Сравним условия.', 'Изменим одно условие.', 'Теперь сравним.'];
          await r.page.locator('main').evaluate(async (root, captions) => {
            const doc = structuredClone(root.scene.authoring.document);
            doc.chapters[0].beats.forEach((beat, index) => {
              beat.text = captions[index];
              beat.speech = { id: `thought.${beat.id}`, when: { basis: 'presented', models: [] } };
            });
            await root.scene.authoring.replace(doc);
          }, captions);
          for (const time of [0, 2.5, 6]) {
            await r.seek(time);
            const caption = captions[time === 0 ? 0 : time === 2.5 ? 1 : 2];
            const active = time === 0 ? 'before' : 'after';
            assert(
              await r.page
                .locator(
                  `[data-comparison-case="${active}"] .vs-lettering[aria-label="${caption}"]`,
                )
                .isVisible(),
              `${kind}/${width}/${time}: visible narrative follows active case`,
            );
            assert.equal(
              await r.page
                .locator(
                  `[data-comparison-case="${active === 'before' ? 'after' : 'before'}"] .vs-lettering[aria-label="${caption}"]`,
                )
                .count(),
              0,
            );
            const state = await r.capture.evaluate((scene) => scene.snapshot());
            const pair = state.comparison;
            if (kind === 'lever') {
              assert.equal(pair.before.state.equilibrium, false);
              assert.equal(pair.after.state.equilibrium, true);
            } else {
              assert.equal(pair.before.state.trace.status, 'blocked');
              assert.equal(pair.after.state.trace.status, 'delivered');
            }
            assert.equal(
              await r.page.locator('[data-comparison-case="before"]').isVisible(),
              width === 960 || time === 0,
            );
            assert.equal(
              await r.page.locator('[data-comparison-case="after"]').isVisible(),
              time > 0,
            );
            const sizes = await r.page.locator('[data-comparison-case]').evaluateAll((nodes) =>
              nodes.map((node) => {
                const b = node.getBoundingClientRect();
                return { width: b.width, height: b.height };
              }),
            );
            assert(Math.abs(sizes[0].width - sizes[1].width) < 0.001);
            assert(Math.abs(sizes[0].height - sizes[1].height) < 0.001);
            const observed = await r.page.locator('main').evaluate((root) => root.scene.inspect());
            if (kind === 'lever') {
              const moment = observed.objects.find(
                (object) => object.id === `${pair.after.id}:moment`,
              );
              assert.deepEqual(moment.value, pair.after.state.netMoment);
              assert.equal(moment.unit, 'Н·м');
              const force = observed.objects.find(
                (object) => object.id === `${pair.after.id}:rightForce`,
              );
              assert.deepEqual(force.value, pair.after.state.right.force);
              assert.equal(force.unit, 'Н');
              assert.equal(pair.before.module, 'lever');
              assert.equal(pair.after.module, 'lever');
            }

            await writeFile(join(evidence, `${kind}-${width}-${theme}-${time}.png`), await r.png());
          }
          await r.control([
            { type: 'mode', value: 'explore' },
            { type: 'parameters', values: { comparisonCase: 'before' } },
          ]);
          assert(
            await r.page
              .locator(`[data-comparison-case="before"] .vs-lettering[aria-label="${captions[2]}"]`)
              .isVisible(),
          );
          if (width === 375) {
            assert.equal(await r.page.locator('[data-comparison-case="before"]').isVisible(), true);
            assert.equal(await r.page.locator('[data-comparison-case="after"]').isVisible(), false);
          }
          await r.page.getByRole('button', { name: 'Условия', exact: true }).click();
          const caseField = r.page.getByRole('combobox', { name: 'Опыт', exact: true });
          await caseField.press('End');
          await caseField.press('Enter');
          await r.page.waitForFunction(
            () => document.querySelector('main').scene.snapshot().comparisonCase === 'after',
          );
          assert.equal(
            (await r.capture.evaluate((scene) => scene.snapshot())).comparisonCase,
            'after',
          );
          await caseField.press('Home');
          await caseField.press('Enter');
          await r.page.waitForFunction(
            () => document.querySelector('main').scene.snapshot().comparisonCase === 'before',
          );
          assert.equal(
            (await r.capture.evaluate((scene) => scene.snapshot())).comparisonCase,
            'before',
          );
          await r.page.getByRole('button', { name: 'Условия', exact: true }).click();
          const checkpoint = await r.page.locator('main').evaluate((root) => root.scene.capture());
          await r.control([{ type: 'parameters', values: { comparisonCase: 'after' } }]);
          await r.capture.evaluate((scene, value) => scene.restore(value), checkpoint);
          assert.equal(
            (await r.capture.evaluate((scene) => scene.snapshot())).comparisonCase,
            'before',
          );
          const accepted = await r.capture.evaluate((scene) => scene.snapshot());
          await assert.rejects(
            r.page.locator('main').evaluate((root) => {
              const doc = root.scene.authoring.document;
              doc.chapters[0].beats.at(-1).text = 'Очень длинная подпись '.repeat(40);
              return root.scene.authoring.prepare(doc);
            }),
            /short|readable|label/,
          );
          assert.deepEqual(await r.capture.evaluate((scene) => scene.snapshot()), accepted);
          if (kind === 'lever') {
            await r.control([{ type: 'parameters', values: { comparisonValue: 10 } }]);
            assert.equal(
              (await r.capture.evaluate((scene) => scene.snapshot())).comparison.after.state
                .equilibrium,
              false,
            );
            await r.control([{ type: 'undoExperiment' }]);
            assert.equal(
              (await r.capture.evaluate((scene) => scene.snapshot())).comparison.after.state
                .equilibrium,
              true,
            );
            await r.control([{ type: 'parameters', values: { leftArm: 0, rightArm: 0 } }]);
            assert.equal(
              (await r.capture.evaluate((scene) => scene.snapshot())).comparison.after.state
                .equilibrium,
              true,
            );
            await writeFile(join(evidence, `zero-${width}.png`), await r.png());
          } else {
            await r.control([{ type: 'parameters', values: { 'disabled-bank': true } }]);
            const pair = (await r.capture.evaluate((scene) => scene.snapshot())).comparison;
            assert.equal(pair.before.state.trace.status, 'blocked');
            assert.equal(pair.after.state.trace.status, 'blocked');
          }
          const original = await r.page
            .locator('main')
            .evaluate((root) => root.scene.authoring.document);
          const renamed = structuredClone(original),
            previousId = renamed.models[0].id;
          renamed.models[0].id = 'trial';
          for (const view of renamed.views) view.model = 'trial';
          for (const chapter of renamed.chapters)
            for (const beat of chapter.beats) if (beat.operation) beat.operation.model = 'trial';
          await r.page.locator('main').evaluate(async (root, doc) => {
            await root.scene.authoring.replace(doc, { provisional: true });
          }, renamed);
          await r.seek(6);
          const identity = await r.page.locator('main').evaluate((root) => root.scene.inspect());
          const target = kind === 'lever' ? 'trial:after:moment' : 'trial:after:order:417';
          assert.ok(
            identity.objects.some((object) => object.id === target),
            target,
          );
          assert.equal(
            identity.objects.some((object) => object.id.startsWith(previousId + ':')),
            false,
          );
          await r.control([
            { type: 'mode', value: 'explore' },
            { type: 'parameters', values: { comparisonCase: 'after' } },
          ]);
          await r.page.setViewportSize({ width: width === 960 ? 375 : 960, height: 700 });
          await r.page.waitForTimeout(80);
          await r.page
            .waitForFunction(
              () => {
                const frame = document.querySelector('[data-scene-frame]');
                const before = document.querySelector('[data-comparison-case="before"]');
                return (
                  getComputedStyle(before).visibility ===
                    (frame.getBoundingClientRect().width >= 766 ? 'inherit' : 'hidden') ||
                  (frame.getBoundingClientRect().width >= 766 &&
                    getComputedStyle(before).visibility === 'visible')
                );
              },
              undefined,
              { timeout: 3000 },
            )
            .catch(async (error) => {
              await writeFile(
                join(evidence, `resize-failure-${kind}-${width}.json`),
                JSON.stringify(
                  await r.page.locator('main').evaluate((root) => ({
                    innerWidth,
                    scene: root.scene.inspect(),
                    frames: [
                      ...root.querySelectorAll('[data-scene-frame],[data-comparison-case]'),
                    ].map((n) => ({
                      tag: n.outerHTML.slice(0, 300),
                      bounds: n.getBoundingClientRect().toJSON(),
                      visibility: getComputedStyle(n).visibility,
                    })),
                  })),
                  null,
                  2,
                ),
              );
              throw error;
            });
          const dimensions = await r.page.locator('[data-comparison-case]').evaluateAll((nodes) =>
            nodes.map((node) => {
              const rect = node.getBoundingClientRect();
              return { width: rect.width, height: rect.height };
            }),
          );
          assert(Math.abs(dimensions[0].width - dimensions[1].width) < 0.001);
          assert(Math.abs(dimensions[0].height - dimensions[1].height) < 0.001);
          const wideNow = await r.page
            .locator('[data-scene-frame]')
            .evaluate((frame) => frame.getBoundingClientRect().width >= 766);
          assert.equal(
            await r.page.locator('[data-comparison-case="before"]').isVisible(),
            wideNow,
          );
          assert.equal(await r.page.locator('[data-comparison-case="after"]').isVisible(), true);
          assert.deepEqual(
            r.messages.filter((m) => m.type === 'error'),
            [],
          );
        } finally {
          await r.close();
        }
      }
    }
  },
);
