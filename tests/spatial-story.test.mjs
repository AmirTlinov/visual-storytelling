import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { renderer } from '../tools/render.mjs';
import { cubeSection, cubeModel } from '../examples/cube-section/model.js';
import {
  project,
  unproject,
  city,
  metre,
  metreX,
  insideRegion,
} from '../examples/spatial-order/geography.js';
import { ThreeKit as T } from '../dist/viewport/index.js';
import { dependencyObservation, instructionalRouteModel } from '../dist/recipes/index.js';

test('source contours, the real anchor and locally projected metric footprint stay intact', async () => {
  const data = JSON.parse(await readFile('examples/spatial-order/geography.json', 'utf8'));
  const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(
    digest(data.geometry),
    'ec4a51711dd7b654e21e4529fd60fbfae9ded094e95edcdbb7f69128472cad13',
  );
  assert.equal(
    digest(data.region.geometry),
    'bad556c48e49eea097521a26869c16005b53c341ddc608cf17c1be3f8423c9a6',
  );
  const point = [40.533935, 56.199221];
  unproject(project(point)).forEach((value, i) => assert(Math.abs(value - point[i]) < 1e-12));
  for (const x of [-40, 40])
    for (const z of [-20, 20])
      assert(insideRegion(city.clone().add(new T.Vector3(x * metreX, 0, z * metre))));
  const east = unproject(city.clone().add(new T.Vector3(80 * metreX, 0, 0)));
  const metres =
    (((east[0] - point[0]) * Math.PI) / 180) * 6371008.8 * Math.cos((point[1] * Math.PI) / 180);
  assert(Math.abs(metres - 80) < 1e-6);
});

test('a computed dependency trace cannot announce arrival before it is observed', () => {
  const state = instructionalRouteModel.state({ orderId: '417', reserve: 'none' });
  assert.equal(state.trace.status, 'delivered');
  assert.equal(dependencyObservation(state.trace, 0).outcome, 'travelling');
  assert.equal(dependencyObservation(state.trace, 0.999).outcome, 'travelling');
  assert.equal(dependencyObservation(state.trace, 1).outcome, 'delivered');
  assert.equal(dependencyObservation(state.trace, 1, false).outcome, 'removed');
  assert.throws(() => dependencyObservation(state.trace, NaN));
});

test('cube sections preserve exact square geometry and report no intersection outside the solid', () => {
  for (const z of [-1, -0.75, 0, 0.75, 1]) {
    const cut = cubeSection(z);
    assert.equal(cut.area, 4);
    assert.equal(cut.vertices.length, 4);
    assert(
      cut.vertices.every(([x, y, depth]) => Math.abs(x) === 1 && Math.abs(y) === 1 && depth === z),
    );
  }
  for (const z of [-1.2, 1.2]) assert.deepEqual(cubeSection(z), { z, vertices: [], area: 0 });
  assert.throws(() => cubeSection(NaN));
  for (const offset of [-1, 1]) {
    assert.equal(cubeModel.staticState({ offset }).section.area, 4);
    assert.equal(cubeModel.experimentState({ offset }).section.z, offset);
    assert.equal(cubeModel.operations.finish({ offset }).section.area, 4);
  }
});

for (const [scene, width, theme, reduced] of [
  ['spatial-order', 390, 'dark', true],
  ['spatial-order', 1200, 'light', false],
  ['cube-section', 390, 'light', false],
  ['cube-section', 1200, 'dark', true],
]) {
  test(`${scene} ${width}px: pure seek, bounded views, semantic identity, manual checkpoint and readable silent captions`, async () => {
    const r = await renderer({ scene, width, height: 900, theme, reduced, controls: true });
    try {
      const time = scene === 'spatial-order' ? 22 : 10;
      await r.seek(time);
      const before = await r.capture.evaluate((s) => s.snapshot());
      const cameras = await r.page.locator('[data-chapter] canvas').elementHandles();
      let maximum = cameras.length;
      const moments =
        scene === 'spatial-order' ? [39.1, 0, 29.1, 8, 16, 31.1, time] : [21, 0, 5.9, 15, 8, time];
      for (const t of moments) {
        await r.seek(t);
        maximum = Math.max(maximum, await r.page.locator('[data-chapter] canvas').count());
      }
      assert(maximum <= 2, `retained${maximum} GPU canvases`);
      const after = await r.capture.evaluate((s) => s.snapshot());
      assert.deepEqual(after, before, 'the same moment depends on seek history');
      const captions = await r.page.locator('[data-caption]').evaluate((node) => {
        const rect = node.getBoundingClientRect(),
          stage = node.closest('.ve-stage').getBoundingClientRect();
        const font =
          (parseFloat(getComputedStyle(node).fontSize) * rect.height) / node.offsetHeight;
        return {
          font,
          text: node.textContent,
          inside:
            rect.left >= stage.left && rect.right <= stage.right && rect.bottom <= stage.bottom,
        };
      });
      assert(
        captions.font >= 16 && captions.inside && captions.text.trim(),
        JSON.stringify(captions),
      );
      const id = scene === 'spatial-order' ? 'route:order:417' : 'cube:whole';
      await r.control([
        { type: 'select', ids: [id] },
        { type: 'focus', ids: [id] },
      ]);
      const saved = await r.page.locator('main').evaluate((root) => root.scene.capture());
      assert.equal(saved.view.state.following, false);
      const end = scene === 'spatial-order' ? 39.1 : 21;
      await r.seek(end);
      assert(
        (await r.page.locator('main').evaluate((root) => root.scene.inspect())).objects.some(
          (o) => o.id === id && o.provenance,
        ),
      );
      await r.page.locator('main').evaluate(async (root, checkpoint) => {
        await root.scene.restore(checkpoint);
      }, saved);
      const restored = await r.page.locator('main').evaluate((root) => root.scene.capture());
      assert.deepEqual(restored.selected, saved.selected);
      for (const key of ['near', 'far'])
        assert.equal(restored.view.state[key], saved.view.state[key]);
      await r.control([
        { type: 'mode', value: 'explore' },
        {
          type: 'parameters',
          values:
            scene === 'spatial-order'
              ? { 'disabled-bank': true, 'disabled-provider': false }
              : { offset: 1.2 },
        },
      ]);
      const experiment = await r.capture.evaluate((s) => s.snapshot());
      if (scene === 'spatial-order')
        assert.equal(experiment.content.order.plannedTrace.blocked, 'bank');
      else assert.equal(experiment.content.model.section.area, 0);
      await r.control([{ type: 'undoExperiment' }]);

      await r.control([
        { type: 'mode', value: 'story' },
        { type: 'seek', time },
      ]);
      await mkdir('artifacts/slice09-proof', { recursive: true });
      await writeFile(`artifacts/slice09-proof/${scene}-${width}-${theme}.png`, await r.png());
      await writeFile(
        `artifacts/slice09-proof/${scene}-${width}-${theme}.json`,
        JSON.stringify({ maximum, before, after, experiment, captions }, null, 2),
      );
      assert.deepEqual(
        r.messages.filter((m) => m.type === 'error'),
        [],
      );
    } finally {
      await r.close();
    }
  });
}

for (const width of [390, 1200])
  test(`cube-section ${width}px: authored detail fits the moved section at both boundary planes`, async () => {
    const r = await renderer({
      scene: 'cube-section',
      width,
      height: 900,
      theme: 'light',
      controls: true,
    });
    try {
      await r.seek(10);
      for (const offset of [-1, 1]) {
        await r.control([
          { type: 'mode', value: 'explore' },
          { type: 'parameters', values: { offset } },
        ]);
        const value = await r.capture.evaluate((s) => s.snapshot());
        assert.equal(value.content.model.section.area, 4);
        assert.equal(value.content.camera.following, true);
        const review = await r.capture.evaluate((s) => s.presentation());
        assert.equal(review.clipped.length, 0, JSON.stringify(review));
        await writeFile(
          `artifacts/slice09-proof/cube-section-${width}-offset-${offset}.png`,
          await r.png(),
        );
        await r.control([{ type: 'undoExperiment' }]);
      }
    } finally {
      await r.close();
    }
  });
