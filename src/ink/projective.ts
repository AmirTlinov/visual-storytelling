/** Four corners in reading order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = readonly [XY, XY, XY, XY];
export interface XY {
  x: number;
  y: number;
}

/** A single projective map drives DOM placement, pointer coordinates and exported pixels. */
export function projective(quad: Quad, width: number, height: number) {
  if (
    quad.length !== 4 ||
    ![width, height].every((n) => Number.isFinite(n) && n > 0) ||
    quad.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y))
  )
    throw new Error('A drawing plane needs finite corners and positive dimensions');
  const turns = quad.map((p, i) => {
    const q = quad[(i + 1) % 4]!,
      r = quad[(i + 2) % 4]!;
    return (q.x - p.x) * (r.y - q.y) - (q.y - p.y) * (r.x - q.x);
  });
  if (turns.some((n) => Math.abs(n) < 1e-8)) return undefined;
  if (!turns.every((n) => Math.sign(n) === Math.sign(turns[0]!)))
    throw new Error('Drawing plane corners must form a convex quadrilateral in reading order');
  const [a, b, c, d] = quad;
  const dx = a.x - b.x + c.x - d.x,
    dy = a.y - b.y + c.y - d.y;
  const u = b.x - c.x,
    v = d.x - c.x,
    s = b.y - c.y,
    t = d.y - c.y;
  const det = u * t - v * s;
  if (Math.abs(det) < 1e-8) return undefined;
  const g = (dx * t - v * dy) / det,
    h = (u * dy - dx * s) / det;
  const m = [
    b.x - a.x + g * b.x,
    d.x - a.x + h * d.x,
    a.x,
    b.y - a.y + g * b.y,
    d.y - a.y + h * d.y,
    a.y,
    g,
    h,
  ];
  const at = (x: number, y: number) => {
    x /= width;
    y /= height;
    const z = m[6]! * x + m[7]! * y + 1;
    return { x: (m[0]! * x + m[1]! * y + m[2]!) / z, y: (m[3]! * x + m[4]! * y + m[5]!) / z };
  };
  return {
    at,
    /** Parallel edges need only one native canvas draw, without tessellation. */
    affine:
      Math.abs(g) + Math.abs(h) < 1e-10
        ? ([m[0]! / width, m[3]! / width, m[1]! / height, m[4]! / height, a.x, a.y] as const)
        : undefined,
    inverse(x: number, y: number) {
      const a = m[0]! - x * g,
        b = m[1]! - x * h;
      const d = m[3]! - y * g,
        e = m[4]! - y * h;
      const determinant = a * e - b * d;
      return {
        x: (((x - m[2]!) * e - b * (y - m[5]!)) / determinant) * width,
        y: ((a * (y - m[5]!) - (x - m[2]!) * d) / determinant) * height,
      };
    },
    css: `matrix3d(${m[0]! / width},${m[3]! / width},0,${g / width},${m[1]! / height},${m[4]! / height},0,${h / height},0,0,1,0,${a.x},${a.y},0,1)`,
  };
}

/** Capture samples the same inverse homography as the live DOM, without internal clip edges. */
export function paintPlane(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  quad: Quad,
) {
  const w = source.width,
    h = source.height,
    map = projective(quad, w, h);
  if (!map) return;
  if (map.affine) {
    context.save();
    context.setTransform(...map.affine);
    context.drawImage(source, 0, 0);
    context.restore();
    return;
  }
  const left = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.x)))),
    top = Math.max(0, Math.floor(Math.min(...quad.map((p) => p.y)))),
    right = Math.min(context.canvas.width, Math.ceil(Math.max(...quad.map((p) => p.x)))),
    bottom = Math.min(context.canvas.height, Math.ceil(Math.max(...quad.map((p) => p.y))));
  if (right <= left || bottom <= top) return;
  const plane = document.createElement('canvas');
  plane.width = right - left;
  plane.height = bottom - top;
  const ink = plane.getContext('2d')!;
  const pixels = source.getContext('2d')!.getImageData(0, 0, w, h).data;
  const output = ink.createImageData(plane.width, plane.height),
    target = output.data;
  // Sample premultiplied colour so translucent ink keeps its pigment at edges.
  // This runs only for perspective captures; live playback remains DOM/GPU driven.
  for (let y = 0; y < plane.height; y++)
    for (let x = 0; x < plane.width; x++) {
      const uv = map.inverse(x + left + 0.5, y + top + 0.5);
      const sx = uv.x - 0.5,
        sy = uv.y - 0.5,
        ix = Math.floor(sx),
        iy = Math.floor(sy),
        fx = sx - ix,
        fy = sy - iy;
      let alpha = 0,
        red = 0,
        green = 0,
        blue = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const px = Math.max(0, Math.min(w - 1, ix + dx)),
            py = Math.max(0, Math.min(h - 1, iy + dy)),
            i = (py * w + px) * 4,
            coverage = pixels[i + 3]! * (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy);
          alpha += coverage;
          red += pixels[i]! * coverage;
          green += pixels[i + 1]! * coverage;
          blue += pixels[i + 2]! * coverage;
        }
      if (alpha === 0) continue;
      const i = (y * plane.width + x) * 4;
      target[i] = red / alpha;
      target[i + 1] = green / alpha;
      target[i + 2] = blue / alpha;
      target[i + 3] = alpha;
    }
  ink.putImageData(output, 0, 0);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.beginPath();
  context.moveTo(quad[0].x, quad[0].y);
  for (const point of quad.slice(1)) context.lineTo(point.x, point.y);
  context.closePath();
  context.clip();
  context.drawImage(plane, left, top);
  context.restore();
}
