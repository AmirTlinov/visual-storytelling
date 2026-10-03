import test from 'node:test';
import assert from 'node:assert/strict';
import timing from '../examples/explorer-3d/timeline.json' with { type: 'json' };
import { cueSheet } from '../dist/story/index.js';
import { cellState, lessonState, volume } from '../examples/explorer-3d/model.js';

const sheet = cueSheet(timing);
const cells = (state, exploring = false) => {
  const result = [];
  for (let y = 0; y < 3; y++)
    for (let z = 0; z < 3; z++)
      for (let x = 0; x < 6; x++) {
        const cell = cellState(x, y, z, state, exploring);
        if (cell.visible) result.push(cell);
      }
  return result;
};

test('the same unit grows into a row, a layer and a box; moving cubes keep separate spaces', () => {
  for (const [cue, count] of [
    ['place_unit', 1],
    ['complete_row', 3],
    ['complete_layer', 6],
    ['complete_stack', 12],
    ['fill_extension', 24],
  ]) {
    const { start, end } = timing.cues[cue];
    const final = cells(lessonState(sheet.at(end)));
    assert.equal(final.filter((c) => c.settled).length, count, cue);
    for (let step = 0; step <= 20; step++) {
      const t = start + ((end - start) * step) / 20;
      const moving = cells(lessonState(sheet.at(t)));
      for (let i = 0; i < moving.length; i++)
        for (let j = i + 1; j < moving.length; j++) {
          assert(
            moving[i].position.some(
              (n, axis) => Math.abs(n - moving[j].position[axis]) >= 0.985 - 1e-7,
            ),
            `${cue}: cubes overlap at ${t}`,
          );
        }
      assert.deepEqual(
        lessonState(sheet.at(t)),
        lessonState(sheet.at(t, true)),
        'reduced motion keeps the same computed result',
      );
    }
  }
  const predict = lessonState(sheet.at(timing.cues.prediction.end + 2));
  assert.equal(cells(predict).length, 12, 'the new half stays empty while the learner predicts');
  assert.equal(volume(predict), 24);
  const earlier = lessonState(sheet.at(timing.cues.complete_row.end));
  lessonState(sheet.at(timing.duration));
  assert.deepEqual(
    lessonState(sheet.at(timing.cues.complete_row.end)),
    earlier,
    'backward seek reconstructs the same objects',
  );
});

test('independent length, rows and layers count the visible cubes in exploration', () => {
  for (const state of [
    { x: 1, y: 1, z: 1 },
    { x: 6, y: 2, z: 2 },
    { x: 2, y: 3, z: 1 },
    { x: 6, y: 3, z: 3 },
  ]) {
    assert.equal(cells(state, true).length, volume(state));
  }
});
