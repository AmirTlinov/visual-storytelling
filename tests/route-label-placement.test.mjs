import test from 'node:test';
import assert from 'node:assert/strict';
import { routeLabelPlacement } from '../dist/recipes/route-label-placement.js';

test('a surrounded label refuses a colliding layout instead of selecting the least bad route', () => {
  const center = [160, 90];
  assert.throws(
    () =>
      routeLabelPlacement(
        { x: -50, y: -10, width: 100, height: 20 },
        center,
        [
          [center, [160, 0]],
          [center, [160, 180]],
          [center, [0, 90]],
          [center, [320, 90]],
        ],
        [320, 180],
        12,
        [44, 32],
        6,
      ),
    /needs room outside/,
  );
});
