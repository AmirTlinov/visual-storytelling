import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPage } from '../tools/build-pages.mjs';
import { renderer } from '../tools/render.mjs';

test(
  'validation retains accepted objects and SVG export for all three prepared drawing consumers',
  { timeout: 90000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'drawing-candidate-delivery-'));
    try {
      for (const [recipe, inputs, patch] of [
        ['division', { count: 17, divisor: 4 }, { count: 18 }],
        [
          'fractions',
          {
            leftNumerator: 1,
            leftDenominator: 2,
            rightNumerator: 1,
            rightDenominator: 3,
            action: 'move',
          },
          { leftNumerator: 0 },
        ],
        ['dependency-route', { orderId: '417', reserve: 'none' }, { orderId: '999' }],
      ]) {
        const source = join(directory, recipe),
          built = join(directory, recipe + '-built');
        await mkdir(source);
        const entry = join(source, 'index.html');
        await writeFile(
          entry,
          `<meta charset="utf-8"><main></main><script type="module">
import {IllustratedStory} from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
window.galleryReady=IllustratedStory.mount(document.querySelector('main'),{
document:${JSON.stringify({ recipe, inputs, chapters: [] })},
frame:{width:1280,height:720,scope:'stage'},
});</script>`,
        );
        await buildPage(entry, built, { sourcePackage: true });
        const r = await renderer({ directory: built, width: 960, controls: true });
        try {
          const inspect = () => r.page.locator('main').evaluate((root) => root.scene.inspect());
          const accepted = await inspect();
          const svgBefore = await r.page.locator('main').evaluate((root) => root.scene.exportSVG());
          await r.page.locator('main').evaluate((root, patch) => {
            const create = document.createElementNS.bind(document);
            const canvases = [];
            document.createElementNS = (...args) => {
              const element = create(...args);
              if (element instanceof SVGSVGElement) canvases.push(element);
              return element;
            };
            const candidate = root.scene.authoring.document;
            Object.assign(candidate.models[0].inputs, patch);
            root.scene.authoring.validate(candidate, { authoredInputs: Object.keys(patch) });
            window.checkedCandidate = canvases.find((canvas) =>
              canvas.hasAttribute('data-presentation-pending'),
            );
          }, patch);
          assert(
            await r.page.evaluate(
              () => Boolean(window.checkedCandidate) && !window.checkedCandidate.isConnected,
            ),
            recipe + ': a checked candidate stays outside the accepted DOM',
          );
          const after = await inspect();
          assert.deepEqual(after.snapshot, accepted.snapshot, recipe);
          assert.deepEqual(after.objects, accepted.objects, recipe);
          assert.equal(await r.page.locator('[data-presentation-pending]').count(), 0, recipe);
          assert.equal(
            await r.page.locator('main').evaluate((root) => root.scene.exportSVG()),
            svgBefore,
            recipe + ': no uncommitted SVG enters the export',
          );
          await r.control([{ type: 'parameters', values: patch }]);
          assert(
            await r.page.evaluate(
              () =>
                window.checkedCandidate.isConnected &&
                !window.checkedCandidate.hasAttribute('data-presentation-pending'),
            ),
            recipe + ': render consumes the same checked SVG',
          );
          const changed = await inspect();
          for (const [key, value] of Object.entries(patch))
            assert.equal(changed.parameters.find((field) => field.key === key).value, value);
          assert.equal(await r.page.locator('[data-presentation-pending]').count(), 0);
          await r.control([{ type: 'undoExperiment' }]);
          assert.deepEqual((await inspect()).snapshot, accepted.snapshot);
          assert.deepEqual(
            r.messages.filter((message) => message.type === 'error'),
            [],
          );
        } finally {
          await r.close();
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
