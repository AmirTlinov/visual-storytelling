import test from 'node:test';
import assert from 'node:assert/strict';
import { rasterResolution } from '../dist/raster-budget.js';

test('GPU raster has a bounded pixel budget and texture edges at every aperture', () => {
  const key = Symbol.for('visual-storytelling.render-profile');
  try {
    for (const profile of ['preview', 'final']) {
      globalThis[key] = profile;
      for (const [w, h, dpr, max] of [
        [1888, 1062, 2, 16384],
        [8000, 5, 2, 4096],
        [390, 220, 2, 16384],
        [8192, 8192, 2, 16384],
      ]) {
        const result = rasterResolution(w, h, dpr, max);
        assert(result.width * result.height <= result.maxPixels);
        assert(result.width <= max && result.height <= max);
        assert(result.ratio <= dpr);
        assert.equal(result.profile, profile);
      }
    }
    const high = rasterResolution(1888, 1062, 2, 16384);
    delete globalThis[key];
    const low = rasterResolution(1888, 1062, 2, 16384);
    assert(high.width * high.height > low.width * low.height * 3.8);
    assert.equal(rasterResolution(390, 220, 2, 16384).width, 780);
    assert.throws(() => rasterResolution(0, 20, 2, 4096));
  } finally {
    delete globalThis[key];
  }
});
