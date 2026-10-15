import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { buildScene } from '../tools/build-pages.mjs';
import { renderer } from '../tools/render.mjs';
import { documentTimeline, validateStoryDocument } from '../dist/story/index.js';
const evidence = 'artifacts/continuous-order';
test('continuous story captions fit the real narrow ink aperture and follow the chosen reserve path', async () => {
  await mkdir(evidence, { recursive: true });
  await buildScene('tools/document-modules/continuous-order', evidence + '/built', {
    sourcePackage: true,
    silent: true,
  });
  const document = validateStoryDocument(
      JSON.parse(await readFile('tools/document-modules/continuous-order/story.json', 'utf8')),
    ),
    script = documentTimeline(document);
  for (const [width, theme] of [
    [960, 'light'],
    [375, 'dark'],
  ]) {
    const r = await renderer({
      directory: evidence + '/built',
      width,
      theme,
      reduced: width === 375,
      controls: true,
    });
    try {
      for (const id of ['send', 'failure', 'shared', 'independent', 'try']) {
        const time = script.cues[id].end - 0.01;
        await r.seek(time);
        const s = await r.capture.evaluate((scene) => scene.snapshot());
        assert.equal(s.orderId, '417');
        if (id === 'shared') assert.deepEqual(s.route, ['shop', 'backup', 'provider']);
        if (id === 'try')
          assert.equal(
            await r.page.locator('[data-object="status"]').getAttribute('aria-label'),
            'Что будет, если перестанет отвечать банк?',
          );
        const fit = await r.page
          .locator('[data-object="status"], [data-object="route:status"]')
          .evaluate((node) => {
            const ink = node.getBoundingClientRect(),
              frame = node.closest('.ve-stage').getBoundingClientRect();
            return {
              bottom: ink.bottom,
              right: ink.right,
              left: ink.left,
              frameBottom: frame.bottom,
              frameLeft: frame.left,
              frameRight: frame.right,
            };
          });
        assert.ok(fit.bottom <= fit.frameBottom - 3, JSON.stringify(fit));
        assert.ok(fit.left >= fit.frameLeft && fit.right <= fit.frameRight, JSON.stringify(fit));
        const crowding = await r.page.evaluate(() => {
          const labels = [...document.querySelectorAll('[data-route-label]')];
          const caption = document
            .querySelector('[data-object="status"], [data-object="route:status"]')
            .getBoundingClientRect();
          const overlaps = (a, b) =>
            Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 &&
            Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1;
          return labels.flatMap((label, i) => {
            const box = label.getBoundingClientRect(),
              id = label.dataset.routeLabel;
            return [
              ...(overlaps(box, caption) ? [id + ':caption'] : []),
              ...labels
                .slice(i + 1)
                .filter((other) => overlaps(box, other.getBoundingClientRect()))
                .map((other) => id + ':' + other.dataset.routeLabel),
            ];
          });
        });
        assert.deepEqual(crowding, [], `${width}px / ${id}`);
        await writeFile(`${evidence}/${width}-${id}.png`, await r.png());
      }
      const heading = await r.page.locator('.ve-heading').textContent();
      assert.equal(heading, 'Главы');
      for (const time of [1, 2, 3, 6.5, 7.5, 8.5, 12.5, 13.5, 14.5, 15.5, 18.5, 19.5, 20.5, 21.5]) {
        await r.seek(time);
        const overlaps = await r.page.evaluate(() => {
          const packet = document.querySelector('[data-order-id="417"]').getBoundingClientRect();
          return [...document.querySelectorAll('[data-route-label]')].flatMap((label) => {
            const box = label.getBoundingClientRect();
            return Math.min(box.right, packet.right) - Math.max(box.left, packet.left) > 1 &&
              Math.min(box.bottom, packet.bottom) - Math.max(box.top, packet.top) > 1
              ? [label.dataset.routeLabel]
              : [];
          });
        });
        assert.deepEqual(overlaps, [], `packet crosses a label at ${width}px / ${time}s`);
      }
      assert.deepEqual(
        r.messages.filter((m) => m.type === 'error'),
        [],
      );
    } finally {
      await r.close();
    }
  }
});
