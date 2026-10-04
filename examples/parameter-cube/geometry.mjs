/** One projection of the four real head fragments; shared SvgOrbit owns the camera. */
export function cubeScene(data, spread, yaw, pitch, selected, inkShape, color) {
  const c = Math.cos(yaw),
    s = Math.sin(yaw),
    cp = Math.cos(pitch),
    sp = Math.sin(pitch);
  const rotate = ([x, y, z]) => [
    c * x + s * z,
    cp * y + sp * (-s * x + c * z),
    -sp * y + cp * (-s * x + c * z),
  ];
  const vertices = [
    [-1, -1, -1],
    [-1, -1, 1],
    [-1, 1, -1],
    [-1, 1, 1],
    [1, -1, -1],
    [1, -1, 1],
    [1, 1, -1],
    [1, 1, 1],
  ].map((v) => rotate(v.map((x) => x * 0.47)));
  const faces = [
    { n: [-1, 0, 0], v: [0, 1, 3, 2] },
    { n: [1, 0, 0], v: [4, 6, 7, 5] },
    { n: [0, -1, 0], v: [0, 4, 5, 1] },
    { n: [0, 1, 0], v: [2, 3, 7, 6] },
    { n: [0, 0, -1], v: [0, 2, 6, 4] },
    { n: [0, 0, 1], v: [1, 5, 7, 3] },
  ];
  const visible = faces.map((face) => rotate(face.n)[2] > 1e-9);
  const [, column, head] = selected.split('-').map(Number);
  const cells = [];
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++)
      for (let h = 0; h < 4; h++) {
        const key = [i, j, h].join('-'),
          center = rotate([i - 1.5, j - 1.5, (h - 1.5) * (1 + 0.85 * spread)]);
        const active = key === selected,
          slice = h === head,
          selectedColumn = slice && j === column;
        const points = vertices.map((v) => [
          270 + 43 * (center[0] + v[0]),
          320 - 43 * (center[1] + v[1]),
        ]);
        cells.push({
          key,
          depth: center[2],
          faces: faces.map((face, f) =>
            visible[f]
              ? {
                  d: inkShape(
                    face.v.map((v) => points[v]),
                    i * 16 + j * 4 + h + f,
                  ),
                  display: 'inline',
                  fill: color(data.values[h][i][j], data.color_limit),
                  stroke:
                    active || selectedColumn
                      ? 'var(--ve-purple)'
                      : slice
                        ? 'var(--ve-ink)'
                        : 'var(--ve-pencil)',
                  'stroke-width': active ? 2 : 1.1,
                  'fill-opacity': 1,
                }
              : { display: 'none' },
          ),
        });
      }
  return cells.sort((a, b) => a.depth - b.depth || a.key.localeCompare(b.key));
}
