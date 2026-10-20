import test from 'node:test';
import assert from 'node:assert/strict';
import { PNG } from 'pngjs';
import { matchDrawingFrames } from './plugin/frame-observer.mjs';

const box = { x: 0, y: 0, width: 8, height: 8 };
function picture(changes = []) {
  const png = new PNG({ width: 8, height: 8 });
  png.data.fill(255);
  for (const [x, y, value] of changes) png.data[(y * 8 + x) * 4] = value;
  return PNG.sync.write(png).toString('base64');
}
const frame = (data, ms) => ({ data, timestamp: (1000 + ms) / 1000 });

test('an unchanged or fully occluded subject never passes as a fast viewer response', () => {
  const baseline = picture(),
    control = picture([[2, 2, 0]]);
  const options = { baseline, exclude: [{ x: 1, y: 1, width: 3, height: 3 }] };
  const hidden = matchDrawingFrames(control, [frame(control, 12)], box, 1000, options);
  assert.equal(hidden.observed, false);
  assert.equal(hidden.pixelMs, null);
  assert.equal(
    matchDrawingFrames(baseline, [frame(baseline, 12)], box, 1000, { baseline }).observed,
    false,
  );
  assert.equal(
    matchDrawingFrames(control, [frame(control, 12)], box, 1000, { baseline, exclude: [box] })
      .observed,
    false,
  );
});

test('fast control paint cannot replace the later visible subject frame', () => {
  const baseline = picture(),
    control = picture([[2, 2, 0]]),
    complete = picture([
      [2, 2, 0],
      [6, 6, 0],
    ]);
  const actual = matchDrawingFrames(
    complete,
    [frame(control, 12), frame(complete, 220)],
    box,
    1000,
    {
      baseline,
      exclude: [{ x: 1, y: 1, width: 3, height: 3 }],
    },
  );
  assert.equal(actual.observed, true);
  assert.equal(actual.pixelMs, 220);
  assert(actual.png.equals(Buffer.from(complete, 'base64')));
  assert.throws(
    () => matchDrawingFrames(complete, [frame(complete, -1), frame(control, 12)], box, 1000),
    /No swapped/,
  );
});

test('overlapping and out-of-bounds masks do not reintroduce occluded pixels', () => {
  const baseline = picture(),
    changed = picture([
      [0, 2, 0],
      [3, 2, 0],
      [7, 2, 0],
    ]);
  const actual = matchDrawingFrames(changed, [frame(changed, 12)], box, 1000, {
    baseline,
    exclude: [
      { x: -10, y: 1, width: 15, height: 3 },
      { x: 3, y: 1, width: 20, height: 3 },
    ],
  });
  assert.equal(actual.observed, false);
});
