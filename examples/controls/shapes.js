/* Shape geometry also owns the space available for the counters. */

  const box = [[0, 0], [1, 0], [1, 1], [0, 1]];
  function regular(sides, angle) {
    const points = Array.from({length: sides}, (_, i) => [Math.cos(angle + i * 2 * Math.PI / sides), Math.sin(angle + i * 2 * Math.PI / sides)]);
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]), left = Math.min(...xs), top = Math.min(...ys), width = Math.max(...xs) - left, height = Math.max(...ys) - top;
    return {points: points.map(([x, y]) => [(x - left) / width, (y - top) / height]), height: w => w * height / width};
  }
  const oval = Array.from({length: 48}, (_, i) => [.5 + .5 * Math.cos(i * Math.PI / 24), .5 + .5 * Math.sin(i * Math.PI / 24)]);
  const shapes = [
    {value: 'rect', label: 'Прямоугольник', points: box},
    {value: 'square', label: 'Квадрат', points: box, height: w => w},
    {value: 'triangle', label: 'Треугольник', points: [[.5, 0], [1, 1], [0, 1]]},
    {value: 'diamond', label: 'Ромб', points: [[.5, 0], [1, .5], [.5, 1], [0, .5]]},
    {value: 'trapezoid', label: 'Трапеция', points: [[.22, 0], [.78, 0], [1, 1], [0, 1]]},
    {value: 'parallelogram', label: 'Параллелограмм', points: [[.22, 0], [1, 0], [.78, 1], [0, 1]]},
    {value: 'pentagon', label: 'Пятиугольник', ...regular(5, -Math.PI / 2)},
    {value: 'hexagon', label: 'Шестиугольник', ...regular(6, 0)},
    {value: 'circle', label: 'Круг', points: oval, height: w => w, curved: true},
    {value: 'ellipse', label: 'Эллипс', points: oval, curved: true},
    {value: 'custom', label: 'Своя фигура', points: box}
  ];
  function geometry(value, width) {
    const shape = shapes.find(s => s.value === value);
    if (!shape) throw new Error(`Unknown shape: ${value}`);
    return {...shape, width, height: shape.height ? shape.height(width) : 3};
  }
  function counters(points, count) {
    if (!count) return [];
    let area = 0, cx = 0, cy = 0;
    const edges = points.map((p, i) => {
      const q = points[(i + 1) % points.length], cross = p[0] * q[1] - q[0] * p[1], dx = q[0] - p[0], dy = q[1] - p[1];
      area += cross; cx += (p[0] + q[0]) * cross; cy += (p[1] + q[1]) * cross;
      return {x: p[0], y: p[1], dx, dy, length2: dx * dx + dy * dy};
    });
    cx /= 3 * area; cy /= 3 * area;
    const clearance = (x, y) => {
      let inside = false, distance = Infinity;
      for (const e of edges) {
        if ((e.y > y) !== (e.y + e.dy > y) && x < e.x + e.dx * (y - e.y) / e.dy) inside = !inside;
        const t = Math.max(0, Math.min(1, ((x - e.x) * e.dx + (y - e.y) * e.dy) / e.length2));
        distance = Math.min(distance, Math.hypot(x - e.x - t * e.dx, y - e.y - t * e.dy));
      }
      return inside ? distance : -distance;
    };
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const left = Math.min(...xs), top = Math.min(...ys), w = Math.max(...xs) - left, h = Math.max(...ys) - top;
    const candidates = [[cx, cy]];
    for (let row = 1; row < 8; row++) for (let col = 1; col < 8; col++) candidates.push([left + w * col / 8, top + h * row / 8]);
    // Inward edge samples also cover thin, concave shapes whose centroid lies outside.
    for (const e of edges) {const length = Math.sqrt(e.length2), inset = Math.min(w, h) * .001; candidates.push([e.x + e.dx / 2 - e.dy / length * inset, e.y + e.dy / 2 + e.dx / length * inset]);}
    const ranked = candidates.map(([x, y]) => ({x, y, room: clearance(x, y)})).filter(p => p.room > 0);
    const center = ranked.find(p => p.x === cx && p.y === cy);
    const anchors = [...(center ? [center] : []), ...ranked.sort((a, b) => b.room - a.room).slice(0, 4)];
    let best = [], bestScale = -1;
    for (const anchor of anchors) for (let columns = Math.min(4, count); columns >= 1; columns--) {
      const rows = Math.ceil(count / columns), dots = Array.from({length: count}, (_, i) => {
        const row = Math.floor(i / columns), inRow = Math.min(columns, count - row * columns);
        return [(i % columns - (inRow - 1) / 2) * 33, (row - (rows - 1) / 2) * 32];
      });
      const margin = Math.min(4, anchor.room * .3);
      const fits = (dots, scale) => dots.every(([dx, dy]) => clearance(anchor.x + dx * scale, anchor.y + dy * scale) >= 11.5 * scale + margin);
      let low = 0, high = 1;
      if (fits(dots, 1)) low = 1;
      else for (let i = 0; i < 12; i++) {const mid = (low + high) / 2; if (fits(dots, mid)) low = mid; else high = mid;}
      if (low > bestScale + .001) {bestScale = low; best = dots.map(([dx, dy]) => ({x: anchor.x + dx * low, y: anchor.y + dy * low, radius: 11.5 * low}));}
    }
    return best;
  }
  export const SketchShapes = {options: shapes.map(({value, label}) => ({value, label})), geometry, counters};
