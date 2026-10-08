import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import {
  ThreeKit as T,
  arrangeTensorRows,
  deliverTensorCells,
  readableFrame,
  geometryFrameAnchors,
} from '../dist/viewport/index.js';
function row(count, x, y, cell = 0.65) {
  const object = new T.Group();
  object.position.set(x, y, 0);
  const cells = Array.from({ length: count }, (_, i) => {
    const box = new T.Mesh(new T.BoxGeometry(cell * 0.88, cell * 0.88, cell * 0.74));
    box.position.x = (i - (count - 1) / 2) * cell;
    object.add(box);
    const item = { box, base: box.position.clone(), label: true };
    item.text = {
      show(value) {
        item.label = value;
      },
    };
    return item;
  });
  return {
    object,
    cells,
    reveal() {
      for (const c of cells) c.box.scale.setScalar(1);
    },
    titleLabel: { show() {} },
  };
}
const snapshot = (row) =>
  row.cells.map((c) => ({
    position: c.box.position.toArray(),
    visible: c.box.visible,
    scale: c.box.scale.toArray(),
    label: c.label,
  }));
test('joining preserves the eight original cells, clear lanes, and reverse-seek identity', () => {
  const a = row(4, -2.3, 2.1),
    b = row(4, 2.3, 2.1),
    parents = [a, b];
  const identities = parents.flatMap((r) => r.cells.map((c) => c.box.uuid));
  const join = arrangeTensorRows(parents, [
    [-1.3, -0.1, 0],
    [1.3, -0.1, 0],
  ]);
  for (let step = 0; step <= 120; step++) {
    join(step / 120);
    assert(
      !new T.Box3().setFromObject(a.object).intersectsBox(new T.Box3().setFromObject(b.object)),
    );
    assert.deepEqual(
      parents.flatMap((r) => r.object.children.map((c) => c.uuid)),
      identities,
    );
  }
  join(0.43);
  const before = parents.map((r) => r.object.position.toArray());
  join(1);
  join(0);
  join(0.43);
  assert.deepEqual(
    parents.map((r) => r.object.position.toArray()),
    before,
  );
});
test('delivery preserves cell identity, clear lanes and reverse-seek positions', () => {
  const a = row(8, 0, 2.1),
    b = row(8, 0, 0.4),
    out = row(8, 0, -1.55);
  const animate = deliverTensorCells(out, {
    from: out.cells.map((c) => [c.base.x, c.base.y + 0.9, c.base.z]),
    start: 0.38,
    end: 0.96,
  });
  const ids = out.cells.map((c) => c.box.uuid);
  for (let step = 0; step <= 240; step++) {
    const progress = step / 240;
    animate(progress);
    for (const row of [a, b, out]) row.object.updateWorldMatrix(true, true);
    for (const c of out.cells) {
      if (progress <= 0.38) assert.equal(c.box.visible, false);
      if (!c.box.visible) continue;
      const bounds = new T.Box3().setFromObject(c.box);
      for (const input of [a, b])
        for (const source of input.cells)
          assert(!bounds.intersectsBox(new T.Box3().setFromObject(source.box)));
    }
  }
  assert.deepEqual(
    out.cells.map((c) => c.box.uuid),
    ids,
  );
  assert(out.cells.every((c) => c.box.position.equals(c.base)));
  animate(0.37);
  const at = snapshot(out);
  animate(1);
  animate(0);
  animate(0.37);
  assert.deepEqual(snapshot(out), at);
});
test('delivery follows the current destination and rejects a changed shape before moving cells', () => {
  const target = row(2, 0, 0);
  const animate = deliverTensorCells(target, {
    from: [
      [0, 2, 0],
      [1, 2, 0],
    ],
  });
  target.cells[0].base.x = -3;
  animate(1);
  assert.equal(target.cells[0].box.position.x, -3);
  assert.throws(() => animate([0.4]), /one finite progress per cell/);
  assert.throws(() => animate(NaN), /one finite progress per cell/);
  target.cells.pop();
  assert.throws(() => animate(0), /current tensor shape/);
});

test('tensor snapshots retain cells, refresh source meaning and release the rendered presentation', async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { Tensor3D } from './dist/viewport/tensor.js';
        import { TensorData } from './dist/math/tensor.js';
        import { Viewport3D } from './dist/viewport/three.js';
        import { sceneObjects } from './dist/scene-objects.js';
        import * as T from './dist/viewport/engine.js';
        Object.assign(window, { Tensor3D, TensorData, Viewport3D, sceneObjects, T });
      `,
      resolveDir: resolve('.'),
      loader: 'js',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
  });
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(
      '<div id="host" style="width:800px;height:600px;font-family:sans-serif;--ve-surface:white;--ve-ink:#292724;--ve-blue:#2367B0;--ve-blue-wash:#d7e4f1"></div>',
    );
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const host = document.querySelector('#host');
      window.subjects = sceneObjects(host);
      window.view = Viewport3D.mount(host);
      window.data = new TensorData({ id: 'samples', shape: [2, 2], values: [1, 2, 3, 4] });
      window.source = Tensor3D.mount(view, data, {
        id: 'samples',
        title: 'Samples',
        format: String,
      });
      window.selection = Tensor3D.mount(view, data.transpose([1, 0]).slice(0, 1), {
        id: 'selected',
        format: String,
      });
      selection.object.position.y = -3;
      window.all = new T.Group();
      all.add(source.object, selection.object);
      view.setObject(all);
      window.identities = source.cells.map((cell) => cell.box.uuid);
      window.resources = { geometry: 0, material: 0 };
      source.cell(0, 0).box.geometry.addEventListener('dispose', () => resources.geometry++);
      source.cell(0, 0).box.material.addEventListener('dispose', () => resources.material++);
      source.cell(0, 1).box.visible = false;
      source.cell(0, 1).box.position.y += 0.75;
      window.next = new TensorData({
        id: 'samples',
        shape: [2, 2],
        values: [10, 20000000000, 30, 40],
      });
      source.setData(next);
      selection.setData(next.transpose([1, 0]).slice(0, 1));
    });
    await page.waitForFunction(() => view.capture().subjects.length === 8);
    const state = await page.evaluate(() => {
      const object = subjects.objects().find((object) => object.id === 'selected:0');
      subjects.select(['selected:0']);
      return {
        identities: source.cells.map((cell) => cell.box.uuid),
        original: identities,
        value: source.cell(0, 1).text.element.textContent,
        hidden: !source.cell(0, 1).box.visible,
        displacement: source.cell(0, 1).box.position.y - source.cell(0, 1).base.y,
        width: source.cellWidth,
        geometrySize: source.cell(0, 0).box.geometry.parameters.width,
        object,
        selected: subjects.selected,
        resources,
      };
    });
    assert.deepEqual(state.identities, state.original);
    assert.equal(state.value, '20000000000');
    assert.equal(state.hidden, true);
    assert.equal(state.displacement, 0.75);
    assert(state.width > 1);
    assert.equal(state.geometrySize, state.width * 0.9);
    assert.equal(state.object.value, 20000000000);
    assert.deepEqual(state.object.inputs, ['samples:0,1']);
    assert.deepEqual(state.object.provenance, {
      id: 'samples:0,1',
      tensor: 'samples',
      address: [0, 1],
      index: 1,
      value: 20000000000,
    });
    assert.deepEqual(state.selected, ['selected:0']);
    assert.deepEqual(state.resources, { geometry: 1, material: 0 });
    const removed = await page.evaluate(() => {
      view.setObject(new T.Group(), { fitView: false });
      const remaining = subjects.objects().length;
      const labels = document.querySelectorAll('.ve-surface-label').length;
      view.dispose();
      source.dispose();
      selection.dispose();
      return { remaining, labels, resources };
    });
    assert.deepEqual(removed, { remaining: 0, labels: 0, resources: { geometry: 1, material: 1 } });
  } finally {
    await browser.close();
  }
});
test('readable framing protects projected numbers and titles from asymmetric UI insets', () => {
  for (const [width, height] of [
    [1440, 810],
    [900, 680],
    [390, 800],
  ])
    for (const yaw of [0, 0.25, -0.5]) {
      const camera = new T.PerspectiveCamera(36, width / height, 0.01, 1000);
      const subject = row(8, 0, 2.1);
      const anchors = geometryFrameAnchors([subject.object]);
      anchors.push(
        { position: new T.Vector3(0, 2.92, 0.4), padding: [105, 28] },
        { position: new T.Vector3(0, -2.8, 0.3), padding: [140, 28] },
      );
      const insets = { top: width < 620 ? 260 : 194, bottom: 82, left: 24, right: 24 };
      const pose = readableFrame(camera, {
        center: new T.Vector3(0, -0.6, 0),
        direction: new T.Vector3(Math.sin(yaw), 0, Math.cos(yaw)),
        width,
        height,
        insets,
        minimum: { width: 8, height: 5 },
        anchors,
      });
      camera.position.copy(pose.position);
      camera.lookAt(pose.target);
      camera.updateMatrixWorld();
      for (const anchor of anchors) {
        const p = anchor.position.clone().project(camera),
          x = ((p.x + 1) * width) / 2,
          y = ((1 - p.y) * height) / 2;
        const [px, py] = anchor.padding ?? [12, 12];
        assert(x - px >= insets.left - 0.01 && x + px <= width - insets.right + 0.01);
        assert(y - py >= insets.top - 0.01 && y + py <= height - insets.bottom + 0.01);
      }
    }
});
