import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createBlockExperiment } from '../examples/push-block/model.js';
import {
  validateStoryDocument,
  documentModelsAt,
  documentTimeline,
} from '../dist/story/document.js';
import { cueSheet } from '../dist/story/cues.js';
import { characterCast } from '../dist/characters/cast.js';
import { compileScore } from '../dist/characters/score.js';
import { chibi } from '../dist/characters/packs/chibi.js';
import { characterData } from './characters-fixture.mjs';
import { renderer } from '../tools/render.mjs';
const authored = { angle: 8, friction: 0.55, push: 6 };
const source = JSON.parse(
  await readFile(new URL('../examples/push-block/story.json', import.meta.url)),
);

test('Rapier contacts, Coulomb friction, units and measured motion respond to physical conditions', async () => {
  const p = await createBlockExperiment();
  try {
    const held = p.state(authored, 1);
    assert(held.contacts > 0);
    assert(Math.abs(held.distance) < 0.001);
    assert(Math.abs(held.forces.normal - 2 * 9.81 * Math.cos((8 * Math.PI) / 180)) < 0.001);
    assert(Math.abs(held.forces.friction - held.forces.push - held.forces.downhill) < 0.001);
    for (const time of [0.5, 1.5, 1.5 + 1 / 120]) {
      const boundary = p.state(authored, time);
      assert(
        Math.abs(boundary.forces.friction - boundary.forces.push - boundary.forces.downhill) <
          0.001,
      );
    }
    assert.equal(p.state(authored, 0.5).forces.push, 0);
    assert.equal(p.state(authored, 1.5).forces.push, 6);
    assert.equal(p.state(authored, 1.5 + 1 / 120).forces.push, 0);
    assert.deepEqual(held.units, { length: 'm', time: 's', mass: 'kg', force: 'N' });
    const secondTrial = { ...authored, friction: 0.3 };
    assert(
      Math.abs(p.state(secondTrial, 0.5).distance) < 0.001,
      'the second trial holds before the push',
    );
    assert(p.state(secondTrial, 1.25).distance > 0.1, 'the same force starts the second trial');
    for (const conditions of [
      { ...authored, friction: 0.1 },
      { ...authored, angle: 30 },
    ]) {
      const moving = p.state(conditions, 3);
      assert(moving.distance > 1 && moving.velocity > 0);
      assert(Math.abs(moving.forces.friction - moving.friction * moving.forces.normal) < 0.002);
      assert.equal(moving.trace.length, 61);
      assert.equal(moving.trace.at(-1).distance, moving.distance);
      assert(
        moving.trace.every(
          (s) => s.contacts > 0 && s.forces.friction <= s.friction * s.forces.normal + 0.002,
        ),
      );
    }
  } finally {
    p.dispose();
  }
});

test('continuous fixed-step recording and random-access replay agree independently', async () => {
  const p = await createBlockExperiment();
  try {
    const conditions = { ...authored, friction: 0.1 };
    p.seek(conditions, 0);
    const start = p.world.snapshot();
    const recorded = new Map();
    for (let step = 0; step <= 360; step++) {
      if ([0, 60, 120, 180, 300, 360].includes(step))
        recorded.set(step, structuredClone(p.liveState()));
      if (step < 360) p.world.step();
    }
    for (const step of [360, 60, 300, 0, 180, 120, 360]) {
      const replayed = p.state(conditions, step / 120);
      assert.deepEqual(replayed.position, recorded.get(step).position);
      assert.equal(replayed.velocity, recorded.get(step).velocity);
      assert.deepEqual(replayed.forces, recorded.get(step).forces);
    }
    p.block.impulse([30, 0]);
    assert.deepEqual(p.state(conditions, 1).position, recorded.get(120).position);
    p.world.restore(start);
    assert.equal(p.liveState().time, 0);
  } finally {
    p.dispose();
  }
});

test('short and continuous stories derive the same physical subject from the common document', async () => {
  const p = await createBlockExperiment();
  try {
    const modules = { 'push-block': p.module },
      doc = validateStoryDocument(source, { modules });
    const sheet = cueSheet(documentTimeline(doc, undefined, { modules }));
    const expected = structuredClone(documentModelsAt(doc, sheet.at(4), {}, modules));
    for (const time of [26, 8, 2, 21, 0, 4]) documentModelsAt(doc, sheet.at(time), {}, modules);
    assert.deepEqual(documentModelsAt(doc, sheet.at(4), {}, modules), expected);
    const short = validateStoryDocument({ ...source, chapters: [source.chapters[0]] }, { modules });
    assert.deepEqual(
      documentModelsAt(
        short,
        cueSheet(documentTimeline(short, undefined, { modules })).at(4),
        {},
        modules,
      ).models,
      expected.models,
    );
  } finally {
    p.dispose();
  }
});

test('model-driven cast keeps hand contact and absolute poses through changes, reverse seek and reduced motion', async () => {
  const data = await characterData(chibi);
  let angle = 8;
  const point = ([x, y]) => ({
    x: 720 + 150 * (x * Math.cos((angle * Math.PI) / 180) - y * Math.sin((angle * Math.PI) / 180)),
    y: 430 + 150 * (x * Math.sin((angle * Math.PI) / 180) + y * Math.cos((angle * Math.PI) / 180)),
  });
  const options = {
    pack: chibi,
    set: { width: 1280, height: 720, svg: '', spots: {} },
    cast: { experimenter: { skin: 'tesla-workshop', at: { x: 600, y: 430 }, scale: 0.5 } },
    beats: [{ id: 'push', seconds: 3 }],
    pose: () => ({
      at: point([-0.75, 0]),
      scale: 0.5,
      rotation: (angle * Math.PI) / 180,
      clip: chibi.rig.views.front,
      mood: 'determined',
      reach: [{ hand: 'right', at: point([-0.4, -0.78]) }],
    }),
  };
  const cast = characterCast(data, options, compileScore(options), (a) => a);
  try {
    let expected;
    for (angle of [8, 30, 0, 20, 8]) {
      const pose = cast.sample(1, true);
      assert(pose.contacts.experimenter[0].error < 0.01);
      const snapshot = structuredClone(pose);
      if (!expected) expected = snapshot;
      if (angle === 8) assert.deepEqual(snapshot, expected);
    }
  } finally {
    cast.dispose();
    data.dispose();
  }
});

for (const width of [390, 1200])
  test(
    `fresh physics scene ${width}: seek, experiment, same subject, physical graph and mode handoff`,
    { timeout: 30000 },
    async () => {
      const r = await renderer({
        scene: 'push-block',
        width,
        height: 900,
        theme: width === 390 ? 'dark' : 'light',
        reduced: width === 390,
        controls: true,
      });
      try {
        await r.seek(3.6);
        await r.control([{ type: 'select', ids: ['block'] }]);
        const before = await r.capture.evaluate((s) => s.snapshot());
        for (const time of [26, 16, 0, 21, 3.6]) await r.seek(time);
        assert.deepEqual(await r.capture.evaluate((s) => s.snapshot()), before);
        await r.control([{ type: 'parameters', values: { friction: 0.1 } }]);
        assert((await r.capture.evaluate((s) => s.snapshot())).content.model.distance > 0);
        await r.seek(21);
        const inspected = await r.page.locator('main').evaluate((root) => root.scene.inspect());
        assert(inspected.objects.some((o) => o.id === 'block'));
        assert(inspected.objects.some((o) => o.id === 'distance-plot'));
        assert.equal(inspected.presentation.clipped.length, 0);
        assert.equal(inspected.presentation.unreadableText.length, 0);
        await mkdir('artifacts/slice10', { recursive: true });
        await writeFile(`artifacts/slice10/measure-${width}.png`, await r.png());
        if (width === 1200) {
          await r.seek(3.6);
          await r.page.getByRole('button', { name: 'Живой опыт', exact: true }).click();
          const frozen = await r.page.locator('main').evaluate((root) => ({
            story: window.storyScene.story.currentTime,
            physical: root.scene.simulation.time,
          }));
          await r.page.locator('main').evaluate((root) => root.scene.play());
          await r.page.waitForTimeout(350);
          const live = await r.page.locator('main').evaluate((root) => ({
            story: window.storyScene.story.currentTime,
            physical: root.scene.simulation.time,
            playing: root.scene.inspect().playing,
            storyPlaying: window.storyScene.story.player.state.playing,
          }));
          assert.equal(live.story, frozen.story);
          assert(live.physical > frozen.physical);
          assert(live.playing && !live.storyPlaying);
          await r.capture.evaluate((s) => s.pause());
          const checkpoint = await r.page.locator('main').evaluate((root) => root.scene.capture());
          assert(checkpoint.simulation.time > frozen.physical);
          const paused = await r.page.locator('main').evaluate((root) => root.scene.snapshot());
          await r.page.setViewportSize({ width: 1150, height: 900 });
          await r.control([{ type: 'theme', value: 'dark' }]);
          const refreshed = await r.page.locator('main').evaluate((root) => root.scene.snapshot());
          assert.equal(refreshed.content.model.time, paused.content.model.time);
          assert.deepEqual(refreshed.content.model.position, paused.content.model.position);
          assert.equal(
            await r.page.locator('main').evaluate((root) => root.scene.simulation.active),
            true,
          );
          await assert.rejects(
            r.page
              .locator('main')
              .evaluate(
                (root, c) =>
                  root.scene.restore({ ...c, simulation: { ...c.simulation, time: 999 } }),
                checkpoint,
              ),
            /Invalid physical checkpoint/,
          );
          assert.equal(
            await r.page.locator('main').evaluate((root) => root.scene.simulation.time),
            checkpoint.simulation.time,
          );
          await r.page.getByRole('button', { name: 'К рассказу', exact: true }).click();
          await r.page.locator('main').evaluate((root) => root.scene.ready());
          assert.equal(
            await r.page.locator('main').evaluate((root) => root.scene.simulation.active),
            false,
          );
          await r.page.getByRole('button', { name: 'Живой опыт', exact: true }).click();
          assert.equal(
            await r.page.locator('main').evaluate((root) => root.scene.simulation.time),
            checkpoint.simulation.time,
          );
          await r.seek(10);
          const priorInvalid = await r.page
            .locator('main')
            .evaluate((root) => root.scene.capture());
          await assert.rejects(
            r.page
              .locator('main')
              .evaluate(
                (root, c) =>
                  root.scene.restore({ ...c, simulation: { ...c.simulation, time: 999 } }),
                checkpoint,
              ),
            /Invalid physical checkpoint/,
          );
          assert.deepEqual(
            await r.page.locator('main').evaluate((root) => root.scene.capture()),
            priorInvalid,
          );
          await r.page
            .locator('main')
            .evaluate(async (root, c) => root.scene.restore(c), checkpoint);
          const restored = await r.page.locator('main').evaluate((root) => root.scene.capture());
          assert.deepEqual(restored.simulation, checkpoint.simulation);
          assert.equal(await r.page.locator('main').evaluate((root) => root.scene.playing), false);
          await r.control([{ type: 'parameters', values: { angle: 20 } }]);
          assert.equal(
            (await r.page.locator('main').evaluate((root) => root.scene.snapshot())).content.model
              .angle,
            20,
          );
          assert.equal(
            await r.page.locator('main').evaluate((root) => root.scene.simulation.active),
            false,
          );
          assert.equal(
            await r.page.getByRole('button', { name: 'К рассказу', exact: true }).count(),
            0,
          );
          await r.control([{ type: 'mode', value: 'story' }]);
          await r.seek(26);
          await r.page.getByRole('button', { name: 'Живой опыт', exact: true }).click();
          await r.page.getByRole('button', { name: 'Повторить', exact: true }).click();
          await r.page.waitForTimeout(150);
          await r.page.getByRole('button', { name: 'Пауза', exact: true }).click();
          const repeated = await r.page.locator('main').evaluate((root) => ({
            physical: root.scene.simulation.time,
            story: root.scene.currentTime,
          }));
          assert(repeated.physical > 0 && repeated.physical < 3);
          assert.equal(repeated.story, 26);
        }
        assert.deepEqual(r.messages, []);
      } finally {
        await r.close();
      }
    },
  );
