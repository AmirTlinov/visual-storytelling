import test from 'node:test';
import assert from 'node:assert/strict';
import {
  tensionUnion,
  signedDistance,
  areaThresholds,
  relaxField,
  relaxationAt,
} from '../src/ink/fusion/field.ts';

test('contact makes a neck across empty space without changing distant ink', () => {
  assert.equal(tensionUnion(10, 10, 0), 10);
  assert.ok(tensionUnion(10, 10, 48) < 0);
  assert.equal(tensionUnion(-3, 80, 48), -3);
  assert.ok(tensionUnion(30, 30, 48) > 0);
  assert.equal(tensionUnion(4, 7, 32), tensionUnion(7, 4, 32));
});

test('distance masks retain thin ink and have finite, symmetric exterior distances', () => {
  const width = 31,
    height = 25,
    alpha = new Uint8Array(width * height);
  for (let y = 4; y <= 20; y++) alpha[y * width + 15] = 255;
  const d = signedDistance(alpha, width, height);
  assert.ok(d.every(Number.isFinite));
  assert.equal(d[12 * width + 15], -0.5);
  assert.equal(d[12 * width + 16], 0.5);
  assert.equal(d[12 * width + 7], d[12 * width + 23]);
  assert.ok(d[0]! > 12);
});

test('topology changes preserve interpolated ink area through surface relaxation', () => {
  const width = 140,
    height = 80;
  const from = new Float32Array(width * height),
    to = new Float32Array(from.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const px = x - width / 2,
        py = y - height / 2;
      from[y * width + x] = Math.abs(Math.hypot(px, py) - 24) - 1.5;
      to[y * width + x] = Math.min(Math.hypot(px - 15, py), Math.hypot(px + 15, py)) - 8;
    }
  const softened = [relaxField(from, width, 4), relaxField(to, width, 4)] as const;
  const levels = areaThresholds(from, to, 49, softened);
  const areaA = from.filter((d) => d <= 0).length,
    areaB = to.filter((d) => d <= 0).length;
  assert.equal(levels[0], 0);
  assert.equal(levels[48], 0);
  for (const index of [6, 12, 24, 36, 42]) {
    const t = index / 48,
      relaxation = relaxationAt(t);
    const expected = areaA * (1 - t) + areaB * t;
    let pixels = 0;
    for (let i = 0; i < from.length; i++) {
      const raw = from[i]! * (1 - t) + to[i]! * t;
      const smooth = softened[0][i]! * (1 - t) + softened[1][i]! * t;
      if (raw * (1 - relaxation) + smooth * relaxation <= levels[index]!) pixels++;
    }
    assert.ok(
      Math.abs(pixels - expected) / expected < 0.03,
      `Ink area drift at ${t}: ${pixels} vs ${expected}`,
    );
  }
});
