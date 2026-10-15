import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { buildPage } from '../tools/build-pages.mjs';
import { renderer } from '../tools/render.mjs';

test(
  'drawn wording and visible or accessible captions follow the same current document without enabling voice',
  { timeout: 60000 },
  async () => {
    const source = 'tests/fixtures/text-conditions/index.html';
    const html = await readFile(source, 'utf8');
    for (const captions of ['', '?captions=true', '?captions=overlay']) {
      const variant = captions.includes('overlay') ? 'overlay' : captions ? 'below' : 'accessible';
      const built = `artifacts/slice14/text-conditions/${variant}-built`;
      await buildPage(source, built, {
        sourcePackage: true,
        html: html.replace(
          'new URLSearchParams(location.search)',
          `new URLSearchParams(${JSON.stringify(captions.slice(1))})`,
        ),
      });
      const view = await renderer({
        directory: built,
        width: 390,
        controls: true,
      });
      try {
        await view.seek(1);
        const caption = view.page.locator('[data-caption]');
        assert.equal(await caption.textContent(), 'Один остаётся вне групп.');
        assert.equal(
          await view.page.locator('.vs-lettering[aria-label="Один остаётся вне групп."]').count(),
          1,
        );
        await view.page.locator('main').evaluate(async (root) => {
          const doc = root.scene.authoring.prepare(root.scene.authoring.document, [
            { op: 'set-inputs', modelId: 'division', values: { count: 20 } },
          ]);
          await root.scene.authoring.replace(doc);
        });
        await view.seek(1);
        assert.equal(await caption.textContent(), '');
        assert.equal(
          await view.page.locator('.vs-lettering[aria-label="Один остаётся вне групп."]').count(),
          0,
        );
        const source = await view.page
          .locator('main')
          .evaluate((root) => root.scene.authoring.document);
        assert.equal(source.chapters[0].beats[0].text, 'Один остаётся вне групп.');
        assert.equal(source.models[0].inputs.count, 20);
        assert.equal(await view.page.locator('audio').count(), 0);
        await writeFile(
          `artifacts/slice14/text-conditions/${captions.includes('overlay') ? 'overlay' : captions ? 'below' : 'accessible'}.png`,
          await view.png(),
        );
        assert.deepEqual(
          view.messages.filter((m) => m.type === 'error'),
          [],
        );
      } finally {
        await view.close();
      }
    }
  },
);

test(
  'quiet document factories retain introduction, transition offsets and their accessible wording',
  { timeout: 30000 },
  async () => {
    const built = 'artifacts/slice14/text-conditions/composition-built';
    await buildPage('tests/fixtures/caption-composition/index.html', built, {
      sourcePackage: true,
    });
    const view = await renderer({ directory: built, width: 800, controls: true });
    try {
      assert.equal(view.info.duration, 4.65);
      for (const [time, text] of [
        [0.1, 'Посмотрим вместе.'],
        [0.5, 'Рассмотрим первый опыт.'],
        [3, 'Теперь второй опыт.'],
      ]) {
        await view.seek(time);
        assert.equal(await view.page.locator('[data-caption]').textContent(), text);
      }
      const review = await view.capture.evaluate((scene) => scene.review());
      const second = review.segments.find((unit) => unit.id === 'second.look');
      assert.equal(second.start, 2.65);
      assert.equal(second.end, 4.65);
      assert.equal(second.captionApplicable, true);
    } finally {
      await view.close();
    }
  },
);

test(
  'a retained recording cannot impersonate the generated introduction by reusing its ID',
  { timeout: 30000 },
  async () => {
    const source = 'tests/fixtures/caption-composition/index.html';
    const html = (await readFile(source, 'utf8')).replace(
      'const collision = false;',
      'const collision = true;',
    );
    const built = 'artifacts/slice14/text-conditions/intro-collision-built';
    await buildPage(source, built, { sourcePackage: true, html });
    const view = await renderer({ directory: built, width: 800, controls: true });
    try {
      await view.seek(2);
      assert.equal(await view.page.locator('[data-caption]').textContent(), '');
      const review = await view.capture.evaluate((scene) => scene.review());
      assert.equal(review.segments.find((unit) => unit.id === 'opening').captionApplicable, false);
      assert.deepEqual(
        view.messages.filter((m) => m.type === 'error'),
        [],
      );
    } finally {
      await view.close();
    }
  },
);
