import { signedDistance } from './field.js';

export interface FusionShape {
  readonly width: number;
  readonly height: number;
  readonly pixelsWide: number;
  readonly pixelsHigh: number;
  readonly distance: Float32Array;
  readonly bounds: { width: number; height: number };
}
export interface FusionPose {
  x: number;
  y: number;
  scale?: number;
  rotation?: number;
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
    pixelsWide: canvas.width,
    pixelsHigh: canvas.height,
    distance: signedDistance(alpha, canvas.width, canvas.height).map((d) => d / resolution),
    bounds: { width: (x1 - x0 + 1) / resolution, height: (y1 - y0 + 1) / resolution },
  };
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
  return fusionShape(width, height, (ctx) => {
    ctx.font = context.font;
    ctx.fillText(text, 56 + metrics.actualBoundingBoxLeft, 56 + metrics.actualBoundingBoxAscent);
  });
}

export function sampleShape(shape: FusionShape, pose: FusionPose, x: number, y: number): number {
  const scale = pose.scale ?? 1,
    angle = pose.rotation ?? 0;
  const dx = (x - pose.x) / scale,
    dy = (y - pose.y) / scale;
  const localX = dx * Math.cos(angle) + dy * Math.sin(angle);
  const localY = dy * Math.cos(angle) - dx * Math.sin(angle);
  const u = (localX / shape.width + 0.5) * shape.pixelsWide - 0.5;
  const v = (localY / shape.height + 0.5) * shape.pixelsHigh - 0.5;
  const cx = Math.max(0, Math.min(shape.pixelsWide - 1, u)),
    cy = Math.max(0, Math.min(shape.pixelsHigh - 1, v));
  const ix = Math.floor(cx),
    iy = Math.floor(cy),
    fx = cx - ix,
    fy = cy - iy;
  const get = (px: number, py: number) =>
    shape.distance[
      Math.min(py, shape.pixelsHigh - 1) * shape.pixelsWide + Math.min(px, shape.pixelsWide - 1)
    ]!;
  const top = get(ix, iy) * (1 - fx) + get(ix + 1, iy) * fx;
  const bottom = get(ix, iy + 1) * (1 - fx) + get(ix + 1, iy + 1) * fx;
  return (
    (top * (1 - fy) +
      bottom * fy +
      Math.hypot(
        Math.max(Math.abs(localX) - shape.width / 2, 0),
        Math.max(Math.abs(localY) - shape.height / 2, 0),
      )) *
    scale
  );
}
