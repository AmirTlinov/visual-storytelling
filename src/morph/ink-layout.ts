import { fusionText } from '../ink/fusion/text.js';
import type { FusionShape, FusionPose } from '../ink/fusion/shape.js';
import type { InkOperation } from './ink-operation.js';

/** Measure visible strokes, not the empty margins of an imported mask. */
function centered(shape: FusionShape): FusionShape {
  let left = Infinity,
    top = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  if (!shape.paths?.length) throw new Error('Ink objects need finite visible strokes');
  for (const path of shape.paths) {
    if (!path.length) throw new Error('Ink objects need finite visible strokes');
    for (const point of path) {
      if (point.length !== 3 || !point.every(Number.isFinite) || point[2] < 0)
        throw new Error('Ink objects need finite visible strokes');
      left = Math.min(left, point[0] - point[2]);
      right = Math.max(right, point[0] + point[2]);
      top = Math.min(top, point[1] - point[2]);
      bottom = Math.max(bottom, point[1] + point[2]);
    }
  }
  const width = right - left,
    height = bottom - top;
  if (!(width > 0 && height > 0)) throw new Error('Ink objects need positive visible bounds');
  const x = (left + right) / 2,
    y = (top + bottom) / 2;
  return {
    ...shape,
    width,
    height,
    bounds: { width, height },
    paths: shape.paths.map((path) => path.map(([px, py, radius]) => [px - x, py - y, radius])),
    text: shape.text && {
      ...shape.text,
      glyphs: shape.text.glyphs.map((glyph) => ({
        ...glyph,
        center: [glyph.center[0] - x, glyph.center[1] - y],
      })),
    },
  };
}

/** One measured layout for text and silhouettes. Extra items wrap before text becomes tiny. */
export function inkLayout(operation: InkOperation, width: number) {
  const values = [...operation.sources, ...operation.targets];
  const block = values.some(
    (value) => typeof value === 'string' && (/\s/.test(value) || value.length > 14),
  );
  const letters = values.every((value) => typeof value === 'string' && [...value].length === 1);
  const count = Math.max(operation.sources.length, operation.targets.length);
  const available = Math.max(1, width - Math.min(36, width * 0.12));
  const size = block
    ? width < 480
      ? 25
      : 30
    : letters
      ? Math.max(64, Math.min(180, width / (count * 1.8)))
      : Math.max(32, Math.min(96, width / (count * 7)));
  const gap = block ? 68 : 48;
  const prepare = (values: InkOperation['sources']) => {
    const shapes = values.map((value) =>
      centered(
        typeof value === 'string'
          ? fusionText(value, { size, maxWidth: available, align: block ? 'left' : 'center' })
          : value,
      ),
    );
    const items = shapes.map((shape, i) => {
      const scale = Math.min(
        1,
        available / shape.bounds.width,
        typeof values[i] === 'string'
          ? 1
          : Math.max(215, Math.min(width, 480)) / shape.bounds.height,
      );
      return { width: shape.bounds.width * scale, height: shape.bounds.height * scale, scale };
    });
    const rows: { indices: number[]; width: number; height: number }[] = [];
    for (const [index, item] of items.entries()) {
      let row = rows.at(-1);
      if (!row || block || row.width + gap + item.width > available) {
        row = { indices: [], width: 0, height: 0 };
        rows.push(row);
      }
      row.width += (row.indices.length ? gap : 0) + item.width;
      row.height = Math.max(row.height, item.height);
      row.indices.push(index);
    }
    const height = rows.reduce((sum, row) => sum + row.height, 0) + gap * (rows.length - 1);
    const poses: FusionPose[] = [];
    let y = -height / 2;
    for (const row of rows) {
      let x = -row.width / 2;
      for (const index of row.indices) {
        const item = items[index]!;
        poses[index] = { x: x + item.width / 2, y: y + row.height / 2, scale: item.scale };
        x += item.width + gap;
      }
      y += row.height + gap;
    }
    return { shapes, poses, height };
  };
  const sources = prepare(operation.sources),
    targets = prepare(operation.targets);
  return { sources, targets, height: Math.max(215, sources.height + 64, targets.height + 64) };
}
