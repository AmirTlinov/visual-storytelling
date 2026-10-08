import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { serve } from '../tools/site.mjs';
import { renderer } from '../tools/render.mjs';
import { at } from './support/computer.mjs';

test(
  'manual experiments restore their complete inputs, paths and visible result through one checkpoint',
  { timeout: 90000 },
  async () => {
    const server = await serve('site');
    const browser = await chromium.launch({
      args: process.platform === 'darwin' ? ['--use-angle=metal', '--enable-gpu'] : [],
    });
    let output;
    try {
      const page = await browser.newPage({
        viewport: { width: 960, height: 1200 },
        reducedMotion: 'reduce',
      });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const open = async (name) => {
        await page.goto(`${server.url}/${name}/index.html`);
        await page.evaluate(() => window.galleryReady);
      };
      const capture = () =>
        page.evaluate(() => {
          const scene = document.querySelector('.ve-scene').scene;
          return { snapshot: scene.snapshot(), checkpoint: scene.capture() };
        });
      const restore = (checkpoint) =>
        page.evaluate(
          (value) => document.querySelector('.ve-scene').scene.restore(value),
          checkpoint,
        );
      const descend = async (key) => {
        await page.locator(`[data-hit-key="${key}"]`).press('Enter');
        await page.waitForFunction(() => !document.querySelector('.explorer-hits').hidden);
      };

      await open('computer-explorer');
      await page.evaluate(
        async (input) => {
          const scene = document.querySelector('.ve-scene').scene;
          await scene.restore({ ...scene.capture(), subject: { ...scene.snapshot(), ...input } });
        },
        at('unified', 'gpu'),
      );
      await page.locator('[data-job-open="ram"]').click();
      await page.waitForFunction(
        () => document.querySelector('#computer-explorer').dataset.moving === 'false',
      );
      for (const key of ['byte-0', 'bit-5', 'capacitor']) await descend(key);
      await page.locator('[data-value="charge"]').click();
      const computer = await capture();
      assert.equal(computer.snapshot.imageJob.ram[0], 0);
      assert.equal(computer.snapshot.imageJob.phase, 'gpu');
      await page.reload();
      await page.evaluate(() => window.galleryReady);
      assert.deepEqual(
        (await capture()).snapshot,
        computer.snapshot,
        'widget reload restores the same machine and path',
      );
      await page.locator('[data-architecture="discrete"]').click();
      assert.notDeepEqual((await capture()).snapshot, computer.snapshot);
      await restore(computer.checkpoint);
      assert.deepEqual((await capture()).snapshot, computer.snapshot);
      assert.equal(
        await page.locator('#computer-explorer').getAttribute('data-scene'),
        'capacitor',
      );
      assert.equal(
        await page.locator('[data-value="charge"]').getAttribute('aria-pressed'),
        'false',
      );
      await assert.rejects(
        restore({
          ...computer.checkpoint,
          subject: { ...computer.checkpoint.subject, architecture: 'unknown' },
        }),
        /Некорректные/,
      );
      assert.deepEqual(
        (await capture()).snapshot,
        computer.snapshot,
        'invalid input leaves the machine intact',
      );

      await open('neuron-explorer');
      await page.getByRole('slider', { name: 'Вход A', exact: true }).fill('4');
      await page.getByRole('slider', { name: 'Вход B', exact: true }).fill('3');
      await page.getByRole('slider', { name: 'Порог', exact: true }).fill('26');
      await descend('sum');
      await descend('term-1');
      await page.locator('body').press('+');
      const neuron = await capture();
      assert.deepEqual(neuron.snapshot.keys, ['sum', 'term-1']);
      assert.equal(neuron.snapshot.sum, 24);
      await page.reload();
      await page.evaluate(() => window.galleryReady);
      assert.deepEqual(
        (await capture()).checkpoint.subject,
        neuron.checkpoint.subject,
        'widget reload keeps the deep path and camera',
      );
      await page.getByRole('slider', { name: 'Вход A', exact: true }).fill('0');
      await page.locator('.explorer-back').click();
      await restore(neuron.checkpoint);
      assert.deepEqual((await capture()).snapshot, neuron.snapshot);
      assert.deepEqual((await capture()).checkpoint.subject, neuron.checkpoint.subject);
      assert.match(
        await page.locator('.ve-view-actions .caption').textContent(),
        /3 \+ 3 \+ 3 \+ 3 = 12/,
      );
      assert.equal(
        await page.getByRole('slider', { name: 'Вход A', exact: true }).inputValue(),
        '4',
      );

      await open('ink-fusion');
      await page.locator('summary').click();
      await page.getByRole('radio', { name: 'Предложения', exact: true }).check();
      const texts = ['Две части.', 'Один результат.', 'Части образуют целое.'];
      for (let i = 0; i < texts.length; i++) await page.locator('textarea').nth(i).fill(texts[i]);
      await page.waitForFunction(
        (texts) =>
          JSON.stringify(document.querySelector('.ve-scene').scene.snapshot().texts) ===
          JSON.stringify(texts),
        texts,
      );
      await page.getByRole('slider', { name: 'Натяжение', exact: true }).fill('51');
      await page.getByRole('slider', { name: 'Позиция рассказа', exact: true }).fill('1.7');
      const fusion = await capture();
      assert.equal(fusion.checkpoint.time, 1.7);
      await page.reload();
      await page.evaluate(() => window.galleryReady);
      assert.deepEqual(
        (await capture()).checkpoint,
        fusion.checkpoint,
        'widget persistence keeps inputs and clock together',
      );
      await page.getByRole('radio', { name: 'Капли', exact: true }).check();
      await restore(fusion.checkpoint);
      assert.deepEqual((await capture()).snapshot, fusion.snapshot);
      assert.deepEqual(
        await page.locator('textarea').evaluateAll((fields) => fields.map((field) => field.value)),
        texts,
      );
      assert.equal(
        await page.getByRole('radio', { name: 'Предложения', exact: true }).isChecked(),
        true,
      );
      await assert.rejects(
        restore({
          ...fusion.checkpoint,
          time: 3,
          subject: { ...fusion.checkpoint.subject, tension: -1 },
        }),
        /Некорректные/,
      );
      assert.deepEqual(
        (await capture()).snapshot,
        fusion.snapshot,
        'validation runs before changing the clock',
      );

      for (const name of ['bubble-sort', 'shared-memory']) {
        await open(name);
        await page.locator('[data-seek]').fill('3');
        const step = await capture();
        assert.equal(
          step.checkpoint.subject,
          undefined,
          'the existing step parameter is the entire model',
        );
        await page.reload();
        await page.evaluate(() => window.galleryReady);
        assert.deepEqual((await capture()).snapshot, step.snapshot);
        await page.locator('[data-seek]').fill('0');
        await restore(step.checkpoint);
        assert.deepEqual((await capture()).snapshot, step.snapshot);
        assert.equal(await page.locator('[data-seek]').inputValue(), '3');
      }

      output = await renderer({
        scene: 'computer-explorer',
        theme: 'light',
        width: 960,
        height: 1200,
        reduced: true,
        checkpoint: computer.checkpoint,
      });
      assert.deepEqual(
        await output.capture.evaluate((scene) => scene.snapshot()),
        computer.snapshot,
        'PNG export restores the machine in a fresh browser',
      );
      const png = await output.png();
      assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
      if (process.env.VISUAL_STORY_MANUAL_PNG)
        await writeFile(process.env.VISUAL_STORY_MANUAL_PNG, png);
      assert.deepEqual(errors, []);
      assert.deepEqual(
        output.messages.filter((message) => message.type === 'error'),
        [],
      );
    } finally {
      await output?.close();
      await browser.close();
      await server.close();
    }
  },
);
