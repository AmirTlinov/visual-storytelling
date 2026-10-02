import { SketchShapes } from './shapes.js';
/* Geometry is stored in centimetres on the fixed 8 × 8 drawing area. */

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const bounds = form => {
    const xs = form.points.map(p => p[0]), ys = form.points.map(p => p[1]);
    const x = Math.min(...xs), y = Math.min(...ys);
    return {x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y};
  };
  function create(kind, width) {
    const shape = SketchShapes.geometry(kind, width), x = Math.round((8 - width)) / 2, y = Math.round(8 - shape.height) / 2;
    return {kind, curved: Boolean(shape.curved), uniform: ['square', 'circle', 'pentagon', 'hexagon'].includes(kind), locked: ['square', 'circle'].includes(kind), points: shape.points.map(([u, v]) => [x + u * width, y + v * shape.height])};
  }
  function fit(form, box) {
    const old = bounds(form);
    return {...form, points: form.points.map(([x, y]) => [box.x + (x - old.x) * box.width / old.width, box.y + (y - old.y) * box.height / old.height])};
  }
  function width(form, value) {
    const old = bounds(form), ratio = form.uniform ? old.height / old.width : 0;
    const w = clamp(value, 1, Math.min(8, ratio ? 8 / ratio : 8)), h = ratio ? w * ratio : old.height;
    return fit(form, {x: Math.round(8 - w) / 2, y: Math.round(8 - h) / 2, width: w, height: h});
  }
  const corners = form => {const b = bounds(form); return [[b.x, b.y], [b.x + b.width, b.y], [b.x + b.width, b.y + b.height], [b.x, b.y + b.height]];};
  function resize(form, index, point, proportional = false) {
    const b = bounds(form), vertices = corners(form), opposite = vertices[(index + 2) % 4];
    const sx = vertices[index][0] > opposite[0] ? 1 : -1, sy = vertices[index][1] > opposite[1] ? 1 : -1;
    const maxW = sx > 0 ? 8 - opposite[0] : opposite[0], maxH = sy > 0 ? 8 - opposite[1] : opposite[1];
    let w = clamp(sx * (point[0] - opposite[0]), 1, maxW), h = clamp(sy * (point[1] - opposite[1]), 1, maxH);
    if (proportional || form.locked) {
      const wx = w / b.width, hy = h / b.height;
      const scale = clamp(Math.abs(wx - 1) >= Math.abs(hy - 1) ? wx : hy, Math.max(1 / b.width, 1 / b.height), Math.min(maxW / b.width, maxH / b.height));
      w = b.width * scale; h = b.height * scale;
    }
    return fit(form, {x: sx > 0 ? opposite[0] : opposite[0] - w, y: sy > 0 ? opposite[1] : opposite[1] - h, width: w, height: h});
  }
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  function intersects(a, b, c, d) {
    const on = (p, q, r) => Math.abs(cross(p, q, r)) < 1e-8 && r[0] >= Math.min(p[0], q[0]) - 1e-8 && r[0] <= Math.max(p[0], q[0]) + 1e-8 && r[1] >= Math.min(p[1], q[1]) - 1e-8 && r[1] <= Math.max(p[1], q[1]) + 1e-8;
    return (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b);
  }
  function valid(points) {
    let area = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < .2) return false;
      area += a[0] * b[1] - b[0] * a[1];
      for (let j = i + 1; j < points.length; j++) {
        if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
        if (intersects(a, b, points[j], points[(j + 1) % points.length])) return false;
      }
    }
    const b = bounds({points});
    return area >= 1 && b.width >= 1 && b.height >= 1;
  }
  function vertex(form, index, point) {
    const points = form.points.map(p => [...p]);
    points[index] = point.map(n => clamp(n, 0, 8));
    return valid(points) ? {kind: 'custom', curved: false, uniform: false, locked: false, points} : null;
  }
  export const ShapeModel = {create, bounds, width, corners, resize, vertex};
