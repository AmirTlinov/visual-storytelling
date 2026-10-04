import { surfaceInscriptions } from '../../src/morph/ink.js';
import { fusionText } from '../../src/ink/fusion/text.js';
import { volumeBox } from '../../src/viewport/morph/field.js';
import type { InkFieldFrame } from '../../src/ink/fusion/geometry.js';
import type { MorphBody } from '../../src/morph/objects.js';
import { Morph } from '../../src/morph/objects.js';
import { Morph2D } from '../../src/morph/object-2d.js';
import { Morph3D } from '../../src/morph/object-3d.js';
import { Viewport3D } from '../../src/viewport/three.js';
import { cueSheet } from '../../src/story/cues.js';

/** Uses real font measurements and glyph strokes; no renderer or layout mocks. */
export function verifyInscriptions() {
  const caption = 'Поверхность хранит прежнюю надпись';
  const identity = new Float64Array([1, 1, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0]);
  const ink = surfaceInscriptions();
  const box = (size: readonly [number, number, number], value = caption): MorphBody => ({
    shape: volumeBox(size),
    text: value,
    position: [0, 0, 0],
  });
  const sample = (source: MorphBody, target = source, morph = 0, pixel = 0.001) =>
    ink.sample({ sources: [source], targets: [target], morph }, pixel, identity);
  const bounds = (frame: InkFieldFrame) => {
    let left = Infinity,
      right = -Infinity,
      top = Infinity,
      bottom = -Infinity,
      radius = 0;
    for (const points of frame.segments)
      for (let i = 0; i < points.length; i += 6)
        for (const j of [0, 1]) {
          const x = points[i + j * 2]!,
            y = points[i + j * 2 + 1]!,
            r = points[i + j + 4]!;
          left = Math.min(left, x - r);
          right = Math.max(right, x + r);
          top = Math.min(top, y - r);
          bottom = Math.max(bottom, y + r);
          radius = Math.max(radius, r);
        }
    return {
      width: right - left,
      height: bottom - top,
      cx: (left + right) / 2,
      cy: (top + bottom) / 2,
      radius,
    };
  };
  const flatten = (frame: InkFieldFrame) => frame.segments.flatMap((v) => Array.from(v));
  const cube = box([2, 2, 2]),
    original = sample(cube),
    square = bounds(original);
  const old = fusionText(caption, { size: 100, maxWidth: 1600, lineHeight: 1.25 });
  const oldRadius =
    Math.max(...old.paths.flatMap((p) => p.map((v) => v[2]))) *
    Math.min(1.48 / old.bounds.width, 0.92 / old.bounds.height);
  const initial = flatten(original);
  const scaled = flatten(sample({ ...cube, scale: [1.01, 1.01, 1.01] }));
  const noReflow =
    initial.length === scaled.length &&
    initial.every((v, i) => Math.abs(v - scaled[i]! / 1.01) < 2e-6);
  const narrow = bounds(sample(box([0.8, 4, 1])));
  const wide = bounds(sample(box([6, 1, 1])));
  const restored = JSON.stringify(flatten(sample(cube))) === JSON.stringify(initial);
  const halfway = JSON.stringify(flatten(sample(cube, box([0.8, 4, 1]), 0.4)));
  sample(cube, box([0.8, 4, 1]), 0.9);
  const seekRestores = halfway === JSON.stringify(flatten(sample(cube, box([0.8, 4, 1]), 0.4)));
  const number = '0,858',
    numeric = bounds(sample(box([0.8, 4, 1], number)));
  const rawNumber = fusionText(number, { size: 100, maxWidth: 1e6, lineHeight: 1.25 });
  const clock = (three: boolean) => {
    const host = document.createElement('div');
    host.style.cssText = 'width:320px;height:200px';
    document.body.append(host);
    const view = three ? Viewport3D.mount(host) : undefined;
    const operation = Morph.transform(Morph.box([1, 1, 1]), Morph.sphere(0.5));
    const morph = view
      ? Morph3D.mount(view, operation)
      : Morph2D.mount(host, operation, { id: 'atomic-clock' });
    try {
      const before = JSON.stringify(morph.render(0.3));
      const bad = cueSheet({ duration: 1, cues: { change: { start: 0, end: 1e-300 } } });
      let rejected = false;
      try {
        morph.render(bad.at(5e-301), 'change');
      } catch {
        rejected = true;
      }
      return rejected && JSON.stringify(morph.render(0.3)) === before;
    } finally {
      morph.dispose();
      view?.dispose();
      host.remove();
    }
  };
  return {
    bounds: { square, narrow, wide },
    fontGain: square.radius / oldRadius,
    squareContained: square.width <= 1.48001 && square.height <= 0.92001,
    centered: Math.abs(square.cx) < 0.01 && Math.abs(square.cy) < 0.01,
    narrow:
      narrow.width <= 0.59201 && narrow.height <= 1.84001 && narrow.height > narrow.width * 0.5,
    wide: wide.width <= 4.44001 && wide.height <= 0.46001 && wide.width > wide.height * 4,
    numberIntact:
      Math.abs(numeric.width / numeric.height - rawNumber.width / rawNumber.height) < 0.05,
    noReflow,
    restored,
    seekRestores,
    label: original.label === caption,
    clock2D: clock(false),
    clock3D: clock(true),
  };
}
