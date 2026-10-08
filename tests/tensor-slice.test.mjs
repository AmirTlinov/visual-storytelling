import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const bundle = await build({
  stdin: {
    contents: `
      import { Tensor3D } from './dist/viewport/tensor.js';
      import { TensorSlice3D } from './dist/viewport/tensor-slice.js';
      import { TensorData } from './dist/math/tensor.js';
      import { Viewport3D } from './dist/viewport/three.js';
      import { sceneObjects } from './dist/scene-objects.js';
      import * as T from './dist/viewport/engine.js';
      Object.assign(window, { Tensor3D, TensorSlice3D, TensorData, Viewport3D, sceneObjects, T });
    `,
    resolveDir: resolve('.'),
  },
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
});
let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser.close();
});

async function scene(t) {
  const page = await browser.newPage();
  t.after(() => page.close());
  await page.setContent(
    '<div id="host" style="width:800px;height:600px;font-family:sans-serif;--ve-surface:white;--ve-ink:#292724;--ve-blue:#2367B0;--ve-blue-wash:#d7e4f1;--ve-orange:#B85516;--ve-orange-wash:#eedacb"></div>',
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(() => {
    const host = document.querySelector('#host');
    window.subjects = sceneObjects(host);
    window.view = Viewport3D.mount(host);
    window.initial = new TensorData({
      id: 'samples',
      shape: [2, 3, 4],
      values: Array.from({ length: 24 }, (_, i) => i),
    });
    window.source = Tensor3D.mount(view, initial, { id: 'samples', format: String });
    window.slice = TensorSlice3D.mount(view, source, {
      id: 'picked',
      select: (data) => data.transpose([2, 0, 1]).slice(1, 1),
    });
    window.all = new T.Group();
    source.object.position.set(-0.5, 1.5, 0);
    source.object.rotation.z = 0.15;
    slice.object.position.set(1.2, -4, 0.8);
    slice.object.rotation.z = -0.2;
    slice.object.scale.set(0.8, 1.2, 1);
    all.add(source.object, slice.object);
    view.setObject(all);
    slice.render(0.42);
    window.capture = () => ({
      values: slice.result.data.values,
      origins: slice.result.cells.map((cell) => slice.result.data.origin(cell.index)),
      identities: slice.result.cells.map((cell) => cell.box.uuid),
      positions: slice.result.cells.map((cell) =>
        cell.box.getWorldPosition(new T.Vector3()).toArray(),
      ),
      visible: slice.result.cells.map((cell) => cell.box.visible),
      shape: slice.result.data.shape,
      width: slice.result.cellWidth,
    });
  });
  return page;
}

test('source changes update a transposed non-first-axis slice immediately and preserve reverse seeking', async (t) => {
  const page = await scene(t);
  const changed = await page.evaluate(() => {
    const before = capture();
    const values = initial.values.map((value) => value + 100);
    values[13] = 30000000000;
    source.setData(new TensorData({ id: 'samples', shape: initial.shape, values }));
    const current = capture();
    slice.render(1);
    const arrived = slice.result.cells.every(
      (cell) => cell.box.position.distanceTo(cell.base) < 1e-10,
    );
    slice.render(0);
    slice.render(0.42);
    const rewound = capture();
    slice.render(-1);
    const hidden = slice.result.cells.every((cell) => !cell.box.visible);
    slice.render(0.42);
    let invalid;
    try {
      slice.render(NaN);
    } catch (error) {
      invalid = error.message;
    }
    const afterInvalid = capture();
    slice.render(0.99, true);
    const reducedHidden = slice.result.cells.every((cell) => !cell.box.visible);
    slice.render(1, true);
    const reducedArrived = slice.result.cells.every(
      (cell) => cell.box.visible && cell.box.position.distanceTo(cell.base) < 1e-10,
    );
    return {
      before,
      current,
      rewound,
      afterInvalid,
      arrived,
      hidden,
      invalid,
      reducedHidden,
      reducedArrived,
    };
  });
  const addresses = [12, 16, 20, 13, 17, 21, 14, 18, 22, 15, 19, 23];
  assert.deepEqual(
    changed.current.values,
    addresses.map((value) => (value === 13 ? 30000000000 : value + 100)),
  );
  assert.deepEqual(
    changed.current.origins.map((origin) => origin.index),
    addresses,
  );
  assert.deepEqual(
    changed.current.origins.map((origin) => origin.value),
    changed.current.values,
  );
  assert.deepEqual(changed.current.identities, changed.before.identities);
  assert(changed.current.width > changed.before.width);
  assert.deepEqual(changed.rewound, changed.current);
  assert.deepEqual(changed.afterInvalid, changed.current);
  assert.match(changed.invalid, /finite progress/);
  assert(changed.arrived && changed.hidden && changed.reducedHidden && changed.reducedArrived);

  const relocated = await page.evaluate(async () => {
    slice.render(1);
    document.querySelector('#host').style.width = '360px';
    slice.object.position.x += 3;
    slice.object.rotation.y = 0.3;
    slice.render(1);
    view.invalidate();
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return slice.result.cells.every((cell) => cell.box.position.distanceTo(cell.base) < 1e-10);
  });
  assert(relocated, 'Resize and external transforms preserve the receiving cell coordinates');

  const lanes = await page.evaluate(() => {
    source.object.position.set(0, 2.2, 0);
    source.object.rotation.set(0, 0, 0);
    slice.object.position.set(0, -2.5, 1);
    slice.object.rotation.set(0, 0, 0);
    slice.object.scale.setScalar(1);
    source.setData(
      new TensorData({
        id: 'samples',
        shape: [3, 2, 3],
        values: Array.from({ length: 18 }, (_, i) => i),
      }),
    );
    const boxOf = (cell) => {
      cell.box.updateWorldMatrix(true, false);
      cell.box.geometry.computeBoundingBox();
      return cell.box.geometry.boundingBox.clone().applyMatrix4(cell.box.matrixWorld);
    };
    let collision = false,
      outsideFrame = false,
      reversible = true;
    for (const layer of [1, 2]) {
      slice.setSelection((data) => data.slice(0, layer));
      const frontCells = source.cells.slice(0, layer * 6).map(boxOf);
      const frame = slice.bounds.clone().expandByScalar(1e-8);
      for (let step = 0; step <= 100; step++) {
        slice.render(step / 100);
        for (const cell of slice.result.cells) {
          const box = boxOf(cell);
          outsideFrame ||= !frame.containsBox(box);
          if (cell.box.visible) collision ||= frontCells.some((front) => front.intersectsBox(box));
        }
      }
      slice.render(0.38);
      const middle = JSON.stringify(capture().positions);
      slice.render(1);
      slice.render(0);
      slice.render(0.38);
      reversible &&= middle === JSON.stringify(capture().positions);
    }
    return { collision, outsideFrame, reversible };
  });
  assert.deepEqual(
    lanes,
    { collision: false, outsideFrame: false, reversible: true },
    'Both rear layers use a clear lateral passage inside their fixed camera envelope',
  );
});

test('invalid selections and incompatible descendant shapes are rejected before changing any snapshot', async (t) => {
  const page = await scene(t);
  const result = await page.evaluate(() => {
    const before = capture();
    let badSelection;
    try {
      slice.setSelection(() => new TensorData({ id: 'foreign', shape: [1], values: [1] }));
    } catch (error) {
      badSelection = error.message;
    }
    const afterSelection = capture();
    const leaf = TensorSlice3D.mount(view, slice.result, {
      id: 'leaf',
      select: (data) => data.slice(0, 3),
    });
    all.add(leaf.object);
    leaf.render(0.6);
    const childData = leaf.result.data;
    let badShape;
    try {
      source.setData(
        new TensorData({
          id: 'samples',
          shape: [2, 3, 2],
          values: Array.from({ length: 12 }, (_, i) => i),
        }),
      );
    } catch (error) {
      badShape = error.message;
    }
    const atomic = source.data === initial && leaf.result.data === childData;
    const afterShape = capture();
    source.setData(
      new TensorData({
        id: 'samples',
        shape: initial.shape,
        values: initial.values.map((n) => (n === 13 ? 30000000000 : n + 10)),
      }),
    );
    const updated = capture();
    const childValues = leaf.result.data.values;
    const childPose = leaf.result.cells.map((cell) =>
      cell.box.getWorldPosition(new T.Vector3()).toArray(),
    );
    leaf.render(0.6);
    const sampledChildPose = leaf.result.cells.map((cell) =>
      cell.box.getWorldPosition(new T.Vector3()).toArray(),
    );
    leaf.dispose();
    slice.setSelection((data) => data.slice(2, 1));
    const reshaped = capture();
    return {
      before,
      afterSelection,
      afterShape,
      updated,
      reshaped,
      childValues,
      childPose,
      sampledChildPose,
      atomic,
      badSelection,
      badShape,
    };
  });
  assert.match(result.badSelection, /current source snapshot/);
  assert.match(result.badShape, /slice index/);
  assert(result.atomic);
  assert.deepEqual(result.afterSelection, result.before);
  assert.deepEqual(result.afterShape, result.before);
  assert.deepEqual(
    result.updated.values,
    result.before.values.map((n) => (n === 13 ? 30000000000 : n + 10)),
  );
  assert.deepEqual(result.childValues, [25, 29, 33]);
  assert.deepEqual(result.childPose, result.sampledChildPose);
  assert.deepEqual(result.reshaped.shape, [2, 3]);
  assert.deepEqual(result.reshaped.values, [11, 15, 19, 30000000000, 27, 31]);
});

test('disposing the source or removing the view releases the dependent slice exactly once', async (t) => {
  for (const removal of ['source', 'view']) {
    const page = await scene(t);
    const result = await page.evaluate((removal) => {
      const resources = { geometry: 0, material: 0 };
      slice.result.cells[0].box.geometry.addEventListener('dispose', () => resources.geometry++);
      slice.result.cells[0].box.material.addEventListener('dispose', () => resources.material++);
      if (removal === 'source') source.dispose();
      else view.setObject(new T.Group(), { fitView: false });
      const remaining = subjects
        .objects()
        .filter((object) => object.id.startsWith('picked')).length;
      const detached = slice.object.parent === null;
      const empty = slice.result.cells.length === 0;
      let rejected;
      try {
        slice.render(0.5);
      } catch (error) {
        rejected = error.message;
      }
      slice.dispose();
      view.dispose();
      return { resources, remaining, detached, empty, rejected };
    }, removal);
    assert.deepEqual(result.resources, { geometry: 1, material: 1 });
    assert.equal(result.remaining, 0);
    assert(result.detached && result.empty);
    assert.match(result.rejected, /disposed/);
  }
});
