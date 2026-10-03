import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ThreeKit as T,
  arrangeTensorRows,
  calculateTensorColumns,
  readableFrame,
  geometryFrameAnchors,
} from '../dist/viewport/index.js';
function row(count, x, y, cell = 0.65) {
  const group = new T.Group();
  group.position.set(x, y, 0);
  const cells = Array.from({ length: count }, (_, i) => {
    const box = new T.Mesh(new T.BoxGeometry(cell * 0.88, cell * 0.88, cell * 0.74));
    box.position.x = (i - (count - 1) / 2) * cell;
    group.add(box);
    const item = { box, base: box.position.clone(), label: true };
    item.text = {
      show(value) {
        item.label = value;
      },
    };
    return item;
  });
  return {
    group,
    cells,
    reveal() {
      for (const c of cells) c.box.scale.setScalar(1);
    },
    highlight() {},
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
    assert(!new T.Box3().setFromObject(a.group).intersectsBox(new T.Box3().setFromObject(b.group)));
    assert.deepEqual(
      parents.flatMap((r) => r.group.children.map((c) => c.uuid)),
      identities,
    );
  }
  join(0.43);
  const before = parents.map((r) => r.group.position.toArray());
  join(1);
  join(0);
  join(0.43);
  assert.deepEqual(
    parents.map((r) => r.group.position.toArray()),
    before,
  );
});
test('arithmetic creates results after evaluation and delivers the same cell without intersecting operands', () => {
  const a = row(8, 0, 2.1),
    b = row(8, 0, 0.4),
    out = row(8, 0, -1.55);
  const animate = calculateTensorColumns([a, b], out, { lift: 0.9 });
  const ids = out.cells.map((c) => c.box.uuid);
  for (let step = 0; step <= 240; step++) {
    const state = animate(step / 240);
    for (const row of [a, b, out]) row.group.updateWorldMatrix(true, true);
    for (const [i, c] of out.cells.entries()) {
      if (state.phases[i] <= 0.38) assert.equal(c.box.visible, false);
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
test('readable framing protects projected numbers and titles from asymmetric UI insets', () => {
  for (const [width, height] of [
    [1440, 810],
    [900, 680],
    [390, 800],
  ])
    for (const yaw of [0, 0.25, -0.5]) {
      const camera = new T.PerspectiveCamera(36, width / height, 0.01, 1000);
      const subject = row(8, 0, 2.1);
      const anchors = geometryFrameAnchors([subject.group]);
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
