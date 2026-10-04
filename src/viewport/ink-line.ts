import * as T from './engine.js';

/** Screen-sized ink with subpixel depth tolerance. Back-facing/hidden curves still occlude. */
export function inkLine(dashed: boolean) {
  const material = new T.LineMaterial({
    linewidth: 1.8,
    transparent: true,
    depthWrite: false,
    dashed,
  });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      'gl_Position = clip;',
      `
      gl_Position = clip;
      // A curve and its tessellated host can differ by a fraction of a screen pixel.
      // Bias by that visual tolerance, independent of scene units and camera distance.
      gl_Position.z += projectionMatrix[3][2] * 1.5 / (projectionMatrix[1][1] * resolution.y);
    `,
    );
  };
  const line = new T.Line2(new T.LineGeometry(), material);
  return line;
}

export function updateInkLine(line: T.Line2, points: readonly (readonly number[])[]) {
  let geometry = line.geometry;
  let start = geometry.getAttribute('instanceStart'),
    end = geometry.getAttribute('instanceEnd');
  if (!start || start.count !== points.length - 1) {
    // Three caches the GPU instance capacity on a geometry. Replacing attributes alone
    // leaves a longer curve clipped to the previous chapter's segment count.
    if (start) {
      geometry.dispose();
      geometry = line.geometry = new T.LineGeometry();
    }
    geometry.setPositions(points.flatMap((p) => [p[0]!, p[1]!, p[2] ?? 0]));
  } else {
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i]!,
        b = points[i + 1]!;
      start.setXYZ(i, a[0]!, a[1]!, a[2] ?? 0);
      end.setXYZ(i, b[0]!, b[1]!, b[2] ?? 0);
    }
    start.needsUpdate = end.needsUpdate = true;
  }
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  if (line.material.dashed) line.computeLineDistances();
}
