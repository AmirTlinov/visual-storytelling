import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  Skeleton,
  MixFrom,
  Physics,
  RegionAttachment,
  VertexAttachment,
} from '@esotericsoftware/spine-webgl';
import { performance, readSkeleton, unpackCharacter } from '../dist/characters/performance.js';
import { chibi } from '../dist/characters/packs/chibi.js';

const source = await unpackCharacter(chibi);
const { data } = readSkeleton(source);
const at = { x: 320, y: 650 },
  height = 780;
const make = (track, actor = {}, blend = 0.22) =>
  performance(data, chibi, { skin: 'tesla', at, ...actor }, track, at, height, blend);
const matrix = (b) => [
  b.appliedPose.a,
  b.appliedPose.b,
  b.appliedPose.c,
  b.appliedPose.d,
  b.appliedPose.worldX,
  b.appliedPose.worldY,
];

// Read what Spine renders, including weighted mesh vertices and instant timelines.
function pose(skeleton) {
  return {
    bones: skeleton.bones.map((b) => [b.active, ...matrix(b)]),
    slots: skeleton.slots.map((slot) => {
      const p = slot.appliedPose,
        attachment = p.attachment,
        vertices = [];
      if (attachment instanceof RegionAttachment) {
        const offsets = attachment.sequence.offsets[attachment.sequence.resolveIndex(p)];
        attachment.computeWorldVertices(slot, offsets, vertices, 0, 2);
      } else if (attachment instanceof VertexAttachment) {
        attachment.computeWorldVertices(
          skeleton,
          slot,
          0,
          attachment.worldVerticesLength,
          vertices,
          0,
          2,
        );
      }
      return {
        attachment: attachment?.name ?? null,
        sequence: p.sequenceIndex,
        color: [p.color.r, p.color.g, p.color.b, p.color.a],
        deform: [...p.deform],
        vertices,
      };
    }),
    order: skeleton.drawOrder.appliedPose.map((slot) => slot.data.name),
  };
}

function nativePose(action, time, skin, reduced = false, flip = false) {
  const skeleton = new Skeleton(data);
  skeleton.setSkin(skin);
  skeleton.setupPose();
  skeleton.x = at.x;
  skeleton.y = height - at.y;
  skeleton.scaleX = flip ? -0.77 : 0.77;
  skeleton.scaleY = 0.77;
  const definition = chibi.actions[action],
    animation = data.findAnimation(definition.animation);
  animation.apply(
    skeleton,
    -1,
    reduced ? Math.min(definition.pose ?? 1.2, animation.duration) : time,
    !reduced && !!definition.loop,
    null,
    1,
    MixFrom.setup,
    false,
    false,
    false,
  );
  skeleton.updateWorldTransform(Physics.reset);
  return pose(skeleton);
}

test('character pack retains the native rig, animations, draw order and linked mesh sources', async () => {
  const rig = JSON.parse(
    await readFile(new URL('../src/assets/characters/chibi/rig.json', import.meta.url), 'utf8'),
  );
  for (const key of ['skeleton', 'bones', 'slots', 'constraints', 'animations'])
    assert.deepEqual(source.data[key], rig[key], key);
  assert.equal(Object.keys(chibi.actions).length, 24);
  for (const skin of source.data.skins)
    for (const [slot, entries] of Object.entries(skin.attachments ?? {})) {
      for (const [name, attachment] of Object.entries(entries)) {
        if (attachment.type !== 'linkedmesh') continue;
        const parent = source.data.skins.find((s) => s.name === (attachment.skin ?? 'default'));
        assert.ok(
          parent?.attachments?.[slot]?.[attachment.source],
          `${skin.name}/${slot}/${name} source`,
        );
      }
    }
});

test('all 24 actions on both skins reproduce native attachments, deforms and draw order', () => {
  for (const skin of chibi.skins)
    for (const [action, definition] of Object.entries(chibi.actions)) {
      const actor = make([{ start: 0, action }], { skin });
      const duration = data.findAnimation(definition.animation).duration;
      for (const time of [0, 0.13, 1.2, duration, duration + 0.37]) {
        actor.sample(time);
        assert.ok(
          actor.skeleton.bones.flatMap(matrix).every(Number.isFinite),
          `${skin}/${action}: finite world pose`,
        );
        assert.deepEqual(
          pose(actor.skeleton),
          nativePose(action, time, skin),
          `${skin}/${action}@${time}`,
        );
      }
    }
});

test('absolute sampling survives rewind and interrupted blends without slot or mesh state leaking', () => {
  const actions = Object.keys(chibi.actions);
  for (const spacing of [0.37, 0.07]) {
    const track = actions.map((action, i) => ({ start: i * spacing, action }));
    const actor = make(track);
    const times = track.flatMap(({ start }) => [start, start + 0.031, start + 0.069]);
    const baseline = times.map((time) => {
      const fresh = make(track);
      fresh.sample(time);
      return pose(fresh.skeleton);
    });
    for (const index of [...times.keys()]
      .reverse()
      .concat([...times.keys()].map((i) => (i * 17) % times.length))) {
      actor.sample(times[index], true);
      actor.sample(times[index]);
      assert.deepEqual(
        pose(actor.skeleton),
        baseline[index],
        `spacing ${spacing}, seek ${times[index]}`,
      );
    }
  }
});

test('idea-to-celebration mixes unkeyed channels back to setup without an end-of-blend jump', () => {
  const actor = make([
    { start: 0, action: 'think' },
    { start: 3, action: 'idea' },
    { start: 6, action: 'celebrate' },
  ]);
  // IK bend direction is an authored instant change at action entry. The end
  // of a continuous mix must not introduce another jump in unkeyed channels.
  for (const boundary of [3.22, 6.22]) {
    actor.sample(boundary - 0.00001);
    const before = actor.skeleton.bones.map(matrix);
    actor.sample(boundary + 0.00001);
    const after = actor.skeleton.bones.map(matrix);
    const delta = Math.max(
      ...before.flatMap((bone, i) => bone.map((n, j) => Math.abs(n - after[i][j]))),
    );
    assert.ok(delta < 0.02, `world-transform jump ${delta} at ${boundary}`);
  }
});

test('reduced motion keeps the representative native pose and mirrored contact anchors follow bones', () => {
  for (const action of Object.keys(chibi.actions)) {
    const actor = make([{ start: 0, action }]);
    actor.sample(0.1, true);
    const first = pose(actor.skeleton);
    actor.sample(99, true);
    assert.deepEqual(pose(actor.skeleton), first, `${action}: reduced pose changes over time`);
    assert.deepEqual(first, nativePose(action, 0, 'tesla', true), `${action}: representative pose`);
  }
  const left = make([{ start: 0, action: 'wave' }]);
  const right = make([{ start: 0, action: 'wave' }], { flip: true });
  left.sample(1.2);
  right.sample(1.2);
  for (const name of Object.keys(chibi.anchors)) {
    const a = left.anchor(name),
      b = right.anchor(name);
    assert.ok(Math.abs(a.x + b.x - 2 * at.x) < 1e-7, `${name}: x mirror`);
    assert.ok(Math.abs(a.y - b.y) < 1e-7, `${name}: y mirror`);
  }
  for (const time of [NaN, Infinity, -Infinity]) assert.throws(() => left.sample(time), /finite/);
});
