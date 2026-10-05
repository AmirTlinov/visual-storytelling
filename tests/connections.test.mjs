import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionRoute } from '../dist/layout/connection.js';
import { InkConnection3D } from '../dist/viewport/ink-connection.js';
import * as T from 'three';

// Check actual segments against rectangles, independently of the router's search graph.
function clear(points, box, gap = 0) {
  const tolerance = 1e-6;
  const left = box.x - gap + tolerance,
    right = box.x + box.width + gap - tolerance,
    top = box.y - gap + tolerance,
    bottom = box.y + box.height + gap - tolerance;
  return points.slice(1).every((b, i) => {
    const a = points[i];
    if (Math.abs(a.x - b.x) < tolerance)
      return (
        a.x <= left || a.x >= right || Math.max(a.y, b.y) <= top || Math.min(a.y, b.y) >= bottom
      );
    assert.ok(Math.abs(a.y - b.y) < tolerance, 'every connection segment remains rectilinear');
    return a.y <= top || a.y >= bottom || Math.max(a.x, b.x) <= left || Math.min(a.x, b.x) >= right;
  });
}
test('the same connection clears cards in horizontal, vertical and staggered layouts', () => {
  const from = { x: 0, y: 0, width: 80, height: 50 };
  for (const to of [
    { x: 400, y: 0, width: 100, height: 60 },
    { x: 0, y: 400, width: 100, height: 60 },
    { x: 400, y: 300, width: 100, height: 60 },
  ]) {
    const avoid = [
      { x: 150, y: -60, width: 90, height: 300 },
      { x: -30, y: 150, width: 160, height: 60 },
    ];
    const options = { avoid, gap: 4, clearance: 12 };
    const route = connectionRoute(from, to, options);
    assert.ok(route.points.length >= 2);
    for (const body of [from, to]) assert.ok(clear(route.points, body, 4));
    for (const obstacle of avoid) assert.ok(clear(route.points, obstacle, 12));
    assert.deepEqual(
      connectionRoute(from, to, options),
      route,
      'returning to the layout has no frame history',
    );
  }
});
test('feedback uses separate ports and impossible placements fail without a crossing fallback', () => {
  const body = { x: 0, y: 0, width: 80, height: 50 };
  const loop = connectionRoute(body, body, { clearance: 12 });
  assert.ok(clear(loop.points, body, 3));
  assert.notDeepEqual(loop.start, loop.end);
  const blockedRight = { x: 85, y: -30, width: 40, height: 120 };
  assert.ok(
    clear(
      connectionRoute(body, body, { avoid: [blockedRight], clearance: 4 }).points,
      blockedRight,
      4,
    ),
  );
  assert.throws(() => connectionRoute(body, { ...body }), /No clear connection/);
  assert.throws(() => connectionRoute(body, body, { clearance: -1 }), /nonnegative/);
});
const view = () => ({ camera: new T.PerspectiveCamera(), ink() {}, invalidate() {} });
const card = (parent, x, y, width = 2, height = 1) => {
  const mesh = new T.Mesh(new T.PlaneGeometry(width, height), new T.MeshBasicMaterial());
  mesh.position.set(x, y, 0);
  parent.add(mesh);
  return mesh;
};
const release = (root) =>
  root.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
test('planar links measure nested transforms, keep reveal and signal together, and restore a layout', () => {
  const space = new T.Group();
  space.rotation.set(0.3, -0.6, 0.4);
  space.scale.set(2, 0.7, 1.2);
  const from = card(space, -4, 0),
    to = card(space, 4, 0),
    obstacle = card(space, 0, 0, 2.5, 3);
  const link = InkConnection3D.create(view(), from, to, { space, avoid: [obstacle] });
  try {
    const initial = structuredClone(link.route);
    assert.ok(initial[0][0] > -3 || initial[0][1] !== 0);
    assert.ok(
      clear(
        initial.map(([x, y]) => ({ x, y: -y })),
        { x: -1.25, y: -1.5, width: 2.5, height: 3 },
        0.18,
      ),
    );
    for (const progress of [0.35, 1, 0.05, 0.35]) {
      link.draw(progress);
      const line = link.root.children[0],
        i = line.geometry.instanceCount - 1;
      const end = line.geometry.getAttribute('instanceEnd');
      const actual = [end.getX(i), end.getY(i), end.getZ(i)];
      assert.ok(actual.every((n, j) => Math.abs(n - link.pointAt(progress)[j]) < 1e-5));
    }
    const tip = link.pointAt(0.35);
    to.position.set(-4, -6, 0);
    link.update();
    assert.notDeepEqual(link.route, initial);
    to.position.set(4, 0, 0);
    link.update();
    assert.deepEqual(link.route, initial);
    assert.deepEqual(link.pointAt(0.35), tip);
    obstacle.material.transparent = true;
    obstacle.material.opacity = 0;
    link.update();
    assert.equal(link.route.length, 2, 'transparent ink no longer blocks a connection');
    // Authored visibility survives both path edits and drawing.
    link.root.visible = false;
    obstacle.visible = false;
    link.update();
    link.draw(0.5);
    assert.equal(link.root.visible, false);
    assert.equal(link.route.length, 2);
    from.visible = false;
    link.update();
    link.draw(1);
    assert.equal(link.pointAt(0.5), undefined);
    from.visible = true;
    link.update();
    assert.equal(link.route.length, 2);
  } finally {
    release(space);
  }
});
test('a physical label measures itself in the same update; a failed edit keeps the published route', () => {
  const space = new T.Group(),
    from = card(space, -4, 0),
    to = card(space, 4, 0),
    label = card(space, 0, 0.8, 1, 1);
  let width = 1,
    measurements = 0;
  const physical = {
    object: label,
    update() {
      measurements++;
      label.scale.set(width, width > 1 ? 2 : 1, 1);
    },
  };
  const link = InkConnection3D.create(view(), from, to, {
    space,
    avoid: [physical],
    fromSide: 'top',
    toSide: 'top',
  });
  try {
    const before = structuredClone(link.route);
    width = 7;
    link.update();
    assert.ok(measurements >= 2);
    assert.notDeepEqual(link.route, before);
    assert.ok(
      clear(
        link.route.map(([x, y]) => ({ x, y: -y })),
        { x: -3.5, y: -1.8, width: 7, height: 2 },
        0.18,
      ),
    );
    const accepted = structuredClone(link.route);
    to.position.copy(from.position);
    assert.throws(() => link.update(), /No clear connection/);
    assert.deepEqual(link.route, accepted);
    to.position.set(4, 0, 0);
    const wrapped = { object: from, update() {} };
    const fromLabel = InkConnection3D.create(view(), wrapped, to, { space, avoid: [from] });
    assert.equal(fromLabel.route.length, 2, 'a handle and its object share endpoint identity');
  } finally {
    release(space);
  }
});
