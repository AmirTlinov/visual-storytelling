import { signedDistance } from './field.js';
import { medialPaths } from './skeleton.js';
import type { InkPath } from './transport.js';

export interface FusionShape {
  readonly width: number;
  readonly height: number;
  readonly paths: readonly InkPath[];
  readonly text?: FusionText;
  readonly bounds: { width: number; height: number };
}
export interface FusionPose {
  x: number;
  y: number;
  scale?: number;
  rotation?: number;
}

export interface FusionGlyph {
  value: string;
  word: number;
  line: number;
  paragraph: number;
  center: readonly [number, number];
  size: number;
  paths: number[];
}
export interface FusionText {
  value: string;
  glyphs: FusionGlyph[];
  words: { value: string; glyphs: number[] }[];
  lines: number;
}

/** Any painted silhouette can participate: letters, SVG paths, images or geometry. */
export function fusionShape(
  width: number,
  height: number,
  paint: (context: CanvasRenderingContext2D) => void,
  resolution = 2,
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
    paths: medialPaths(
      signedDistance(alpha, canvas.width, canvas.height).map((d) => d / resolution),
      canvas.width,
      canvas.height,
      1 / resolution,
    ),
    bounds: { width: (x1 - x0 + 1) / resolution, height: (y1 - y0 + 1) / resolution },
  };
}
