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

/** Export uses the same homography as the live DOM; subdivision retains perspective. */
export function paintPlane(
  context: CanvasRenderingContext2D,
  source: HTMLCanvasElement,
  quad: Quad,
) {
  const w = source.width,
    h = source.height,
    map = projective(quad, w, h);
  if (!map) return;
  const triangle = (uv: [XY, XY, XY]) => {
    const p = uv.map((q) => map.at(q.x, q.y));
    const [a, b, c] = uv,
      [pa, pb, pc] = p;
    const det = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    const ax = ((pb!.x - pa!.x) * (c.y - a.y) - (pc!.x - pa!.x) * (b.y - a.y)) / det;
    const ay = ((pb!.y - pa!.y) * (c.y - a.y) - (pc!.y - pa!.y) * (b.y - a.y)) / det;
    const bx = ((pc!.x - pa!.x) * (b.x - a.x) - (pb!.x - pa!.x) * (c.x - a.x)) / det;
    const by = ((pc!.y - pa!.y) * (b.x - a.x) - (pb!.y - pa!.y) * (c.x - a.x)) / det;
    context.save();
    context.beginPath();
    context.moveTo(pa!.x, pa!.y);
    context.lineTo(pb!.x, pb!.y);
    context.lineTo(pc!.x, pc!.y);
    context.closePath();
    context.clip();
    context.setTransform(ax, ay, bx, by, pa!.x - ax * a.x - bx * a.y, pa!.y - ay * a.x - by * a.y);
    context.drawImage(source, 0, 0);
    context.restore();
  };
  const n = 16;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const a = { x: (x * w) / n, y: (y * h) / n },
        b = { x: ((x + 1) * w) / n, y: (y * h) / n };
      const c = { x: ((x + 1) * w) / n, y: ((y + 1) * h) / n },
        d = { x: (x * w) / n, y: ((y + 1) * h) / n };
      triangle([a, b, c]);
      triangle([a, c, d]);
    }
}
