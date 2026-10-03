import { signedDistance } from './field.js';
import { glyphs } from '../glyphs.js';
import { medialPaths } from './skeleton.js';
import type { InkPath, InkPoint } from './transport.js';

export interface FusionShape {
  readonly width: number;
  readonly height: number;
  readonly paths: readonly InkPath[];
  readonly bounds: { width: number; height: number };
}
export interface FusionPose {
  x: number;
  y: number;
  scale?: number;
  rotation?: number;
}

/** Any painted silhouette can participate: letters, SVG paths, images or geometry. */
function createShape(
  width: number,
  height: number,
  paint: (context: CanvasRenderingContext2D) => void,
  resolution = 2,
  paths?: readonly InkPath[],
): FusionShape {
  if (!(width > 0 && height > 0 && resolution > 0) || !Number.isFinite(width + height + resolution))
    throw new Error('Fusion shape dimensions must be positive and finite');
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * resolution);
  canvas.height = Math.ceil(height * resolution);
  if (canvas.width > 4096 || canvas.height > 4096)
    throw new Error('Fusion mask exceeds 4096 pixels per side');
  const context = canvas.getContext('2d', { willReadFrequently: true })!;
  context.scale(canvas.width / width, canvas.height / height);
  paint(context);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = new Uint8Array(canvas.width * canvas.height);
  let x0 = canvas.width,
    x1 = 0,
    y0 = canvas.height,
    y1 = 0,
    ink = false;
  for (let i = 0; i < alpha.length; i++) {
    alpha[i] = pixels[i * 4 + 3]!;
    if (alpha[i]! > 127) {
      ink = true;
      x0 = Math.min(x0, i % canvas.width);
      x1 = Math.max(x1, i % canvas.width);
      y0 = Math.min(y0, Math.floor(i / canvas.width));
      y1 = Math.max(y1, Math.floor(i / canvas.width));
    }
  }
  if (!ink) throw new Error('Fusion shape must contain visible ink');
  return {
    width,
    height,
    paths:
      paths ??
      medialPaths(
        signedDistance(alpha, canvas.width, canvas.height).map((d) => d / resolution),
        canvas.width,
        canvas.height,
        1 / resolution,
      ),
    bounds: { width: (x1 - x0 + 1) / resolution, height: (y1 - y0 + 1) / resolution },
  };
}

export function fusionShape(
  width: number,
  height: number,
  paint: (context: CanvasRenderingContext2D) => void,
  resolution = 2,
): FusionShape {
  return createShape(width, height, paint, resolution);
}

/** Call after the chosen font has loaded. No glyph-specific animation data is needed. */
export function fusionText(
  text: string,
  { size = 100, maxWidth = 320, font = 'SketchPencil, SketchShantell, sans-serif' } = {},
): FusionShape {
  if (!text.trim()) throw new Error('Fusion text must contain a visible character');
  const context = document.createElement('canvas').getContext('2d')!;
  context.font = `400 ${size}px ${font}`;
  size *= Math.min(1, maxWidth / Math.max(1, context.measureText(text).width));
  context.font = `400 ${size}px ${font}`;
  const metrics = context.measureText(text);
  const width = Math.ceil(metrics.actualBoundingBoxLeft + metrics.actualBoundingBoxRight + 112);
  const height = Math.ceil(
    metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent + 112,
  );
  let paths: InkPath[] | undefined;
  if (
    font.startsWith('SketchPencil') &&
    [...text].every((char) => /\s/.test(char) || glyphs[char])
  ) {
    paths = [];
    let cursor = 56 + metrics.actualBoundingBoxLeft - width / 2;
    const baseline = 56 + metrics.actualBoundingBoxAscent - height / 2;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    for (const char of text) {
      const advance = context.measureText(char).width,
        sx = advance / 6.7,
        sy = size * 0.082;
      for (const d of glyphs[char] ?? []) {
        path.setAttribute('d', d);
        const length = path.getTotalLength(),
          count = Math.max(2, Math.ceil((length * Math.max(sx, sy)) / 1.5));
        paths.push(
          Array.from({ length: count }, (_, i): InkPoint => {
            const at = (length * i) / (count - 1),
              point = path.getPointAtLength(at);
            const before = path.getPointAtLength(Math.max(0, at - 0.01)),
              after = path.getPointAtLength(Math.min(length, at + 0.01));
            const tx = (after.x - before.x) * sx,
              ty = (after.y - before.y) * sy,
              norm = Math.hypot(tx, ty) || 1;
            const radius = 0.325 * Math.hypot((sx * ty) / norm, (sy * tx) / norm);
            return [
              cursor + advance * 0.055 + point.x * sx,
              baseline + (point.y - 10) * sy,
              radius,
            ];
          }),
        );
      }
      cursor += advance;
    }
  }
  return createShape(
    width,
    height,
    (ctx) => {
      ctx.font = context.font;
      ctx.fillText(text, 56 + metrics.actualBoundingBoxLeft, 56 + metrics.actualBoundingBoxAscent);
    },
    2,
    paths,
  );
}
