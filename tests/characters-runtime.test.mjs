import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Bone, SkinnedMesh } from 'three';
import { performance } from '../dist/characters/performance.js';
import { chibi } from '../dist/characters/packs/chibi.js';
import { characterDetails } from '../dist/characters/framing.js';
import { characterData, characterPose } from './characters-fixture.mjs';

const data = await characterData(chibi);
const at = { x: 320, y: 650 },
  height = 780;
const make = (track, actor = {}, blend = 0.22) =>
  performance(data, chibi, { skin: 'tesla', at, ...actor }, track, at, height, blend);
const mouth = (actor) =>
  actor.orderedMeshes().find((mesh) => mesh.userData.slot === 'mouth')?.userData.artwork;
const matrices = (actor) => [...actor.bones.values()].map((bone) => bone.matrixWorld.toArray());
const sample = (action, time, actor = {}) => {
  const figure = make([{ action, start: 0 }], actor);
  figure.sample(time);
  const result = characterPose(figure);
  figure.dispose();
  return result;
};

test('portable glTF and every semantic action use Three bones and weighted drawings', () => {
  const source = JSON.parse(chibi.gltf);
  assert.equal(source.asset.version, '2.0');
  assert.equal(Object.keys(chibi.actions).length, 24);
  assert.ok(source.images.every((image) => image.uri.startsWith('data:image/png;base64,')));
  for (const skin of chibi.skins)
    for (const [action, definition] of Object.entries(chibi.actions)) {
      const actor = make([{ action, start: 0 }], { skin });
      const duration = data.clips.find((clip) => clip.name === definition.animation).duration;
      for (const time of [0, 0.13, 1.2, duration, duration + 0.37]) {
        actor.sample(time);
        assert.ok([...actor.bones.values()].every((bone) => bone instanceof Bone));
        assert.ok(actor.meshes.every((mesh) => mesh instanceof SkinnedMesh));
        assert.ok(matrices(actor).flat().every(Number.isFinite), `${skin}/${action}@${time}`);
        const box = actor.bounds();
        assert.ok(box.width > 30 && box.height > 100, `${skin}/${action} has visible drawing`);
        assert.ok(
          actor.orderedMeshes().every((mesh) => chibi.appearances[skin][mesh.userData.artwork]),
        );
      }
      actor.dispose();
    }
});

test('semantic detail shots follow weighted limbs and remain addressable when artwork is hidden', () => {
  for (const skin of ['tesla-workshop', 'mira-scholar']) {
    const actor = make([{ action: 'idle', start: 0 }], { skin });
    for (const [view, clip] of Object.entries(chibi.rig.views)) {
      actor.sample(6.1, false, { at, scale: 0.8, view, clip });
      const details = characterDetails(actor, chibi.rig, height);
      for (const side of ['left', 'right'])
        assert.ok(
          details[`hand-${side}`].width > 10 && details[`hand-${side}`].height > 10,
          `${skin}/${view}/${side}`,
        );
    }
    for (const mesh of actor.meshes) mesh.material.opacity = 0;
    const hidden = characterDetails(actor, chibi.rig, height);
    assert.deepEqual(Object.keys(hidden).sort(), ['face', 'hand-left', 'hand-right']);
    for (const box of Object.values(hidden)) {
      assert.ok([box.x, box.y].every(Number.isFinite));
      assert.equal(box.width, 0);
      assert.equal(box.height, 0);
    }
    actor.dispose();
  }
});

test('rewind and interrupted blends equal a fresh absolute sample without leaking actor state', () => {
  const actions = Object.keys(chibi.actions);
  for (const spacing of [0.37, 0.07]) {
    const track = actions.map((action, i) => ({ start: i * spacing, action }));
    const actor = make(track),
      neighbour = make([{ start: 0, action: 'wave' }], { skin: 'mira' });
    neighbour.sample(1.2);
    const untouched = characterPose(neighbour);
    const times = track.flatMap(({ start }) => [start, start + 0.031, start + 0.069]);
    const baseline = times.map((time) => {
      const fresh = make(track);
      fresh.sample(time);
      const pose = characterPose(fresh);
      fresh.dispose();
      return pose;
    });
    for (const index of [...times.keys()]
      .reverse()
      .concat([...times.keys()].map((i) => (i * 17) % times.length))) {
      actor.sample(times[index], true);
      actor.sample(times[index]);
      assert.deepEqual(
        characterPose(actor),
        baseline[index],
        `spacing ${spacing}, seek ${times[index]}`,
      );
      assert.deepEqual(
        characterPose(neighbour),
        untouched,
        'one actor never changes its neighbour',
      );
    }
    actor.dispose();
    neighbour.dispose();
  }
});

test('repeated clips keep independent playback positions during an interrupted crossfade', () => {
  const actor = make([
    { start: 0, action: 'idle' },
    { start: 0.07, action: 'wave' },
    { start: 0.14, action: 'idle' },
  ]);
  const reference = make([{ start: 0, action: 'idle' }]);
  actor.sample(0.36);
  reference.sample(0.22);
  assert.deepEqual(characterPose(actor), characterPose(reference));
  for (const boundary of [0.14, 0.29, 0.36]) {
    actor.sample(boundary - 1e-6);
    const before = matrices(actor);
    actor.sample(boundary + 1e-6);
    const after = matrices(actor);
    const delta = Math.max(
      ...before.flatMap((bone, i) => bone.map((n, j) => Math.abs(n - after[i][j]))),
    );
    assert.ok(delta < 0.01, `repeated clip changes at ${boundary}: ${delta}`);
  }
  assert.equal(
    new Set(actor.meshes.map((mesh) => mesh.skeleton)).size,
    1,
    'one shared GPU bone palette per actor',
  );
  actor.dispose();
  reference.dispose();
});

test('continuous channels return to the next clip without an end-of-blend jump', () => {
  const actor = make([
    { start: 0, action: 'think' },
    { start: 3, action: 'idea' },
    { start: 6, action: 'celebrate' },
  ]);
  for (const boundary of [3.22, 6.22]) {
    actor.sample(boundary - 0.00001);
    const before = matrices(actor);
    actor.sample(boundary + 0.00001);
    const after = matrices(actor);
    const delta = Math.max(
      ...before.flatMap((bone, i) => bone.map((n, j) => Math.abs(n - after[i][j]))),
    );
    assert.ok(delta < 0.02, `world-transform jump ${delta} at ${boundary}`);
  }
  actor.dispose();
});

test('a completed idea holds its smile through speech, then mixes into a wave and rewinds', () => {
  for (const skin of ['tesla', 'mira']) {
    const actor = make(
      [
        { start: 0, action: 'idea' },
        { start: 8, action: 'wave' },
      ],
      { skin },
    );
    for (const time of [2, 3.1, 7.9]) {
      actor.sample(time);
      assert.deepEqual(characterPose(actor), sample('idea', 2, { skin }));
      assert.match(mouth(actor), /mouth-open-smile$/);
    }
    for (const time of [9.3, 12.7, 8.8]) {
      actor.sample(time);
      assert.deepEqual(characterPose(actor), sample('wave', time - 8, { skin }));
    }
    actor.sample(1.2);
    assert.match(mouth(actor), /mouth-doubt$/);
    for (const time of [2, 21.3, 1.2, 7, 3]) {
      actor.sample(time, false, {
        at,
        scale: 0.77,
        clip: chibi.rig.views.front,
        mood: 'idea',
        moodTime: time,
      });
      assert.match(mouth(actor), time < 1.4 ? /mouth-doubt$/ : /mouth-open-smile$/);
    }
    actor.dispose();
  }
});

test('reduced motion holds one representative pose and mirrored anchors follow the same bones', () => {
  for (const action of Object.keys(chibi.actions)) {
    const actor = make([{ start: 0, action }]);
    actor.sample(0.1, true);
    const first = characterPose(actor);
    actor.sample(99, true);
    assert.deepEqual(characterPose(actor), first, action);
    actor.dispose();
  }
  const left = make([{ start: 0, action: 'wave' }]),
    right = make([{ start: 0, action: 'wave' }], { flip: true });
  left.sample(1.2);
  right.sample(1.2);
  for (const name of Object.keys(chibi.anchors)) {
    const a = left.anchor(name),
      b = right.anchor(name);
    assert.ok(Math.abs(a.x + b.x - 2 * at.x) < 1e-7);
    assert.ok(Math.abs(a.y - b.y) < 1e-7);
  }
  for (const time of [NaN, Infinity, -Infinity]) assert.throws(() => left.sample(time), /finite/);
  left.dispose();
  right.dispose();
});
