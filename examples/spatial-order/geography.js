import { ThreeKit as T } from '@visual-storytelling/core/three';
import data from './geography.json' with { type: 'json' };

const parallel = Math.cos((data.projection.standardParallel * Math.PI) / 180);
const extent = data.projection.referenceExtent;
const scale = Math.min(
  data.projection.width / ((extent.east - extent.west) * parallel),
  data.projection.depth / (extent.north - extent.south),
);
// The map is equirectangular, not a geodesic distance model. Local metre sizes use its standard parallel.
export const metre = (scale * 180) / (Math.PI * 6371008.8);
export const metreX = (metre * parallel) / Math.cos((data.place.coordinates[1] * Math.PI) / 180);
export const REGION_LIFT = 3;
export const geography = data;
export function project([lon, lat], y = 0) {
  const longitude = lon < data.projection.unwrapLongitudeBelow ? lon + 360 : lon;
  return new T.Vector3(
    (longitude - (extent.west + extent.east) / 2) * parallel * scale,
    y,
    ((extent.north + extent.south) / 2 - lat) * scale,
  );
}
export function unproject(point) {
  const longitude = point.x / (parallel * scale) + (extent.west + extent.east) / 2;
  return [
    longitude > 180 ? longitude - 360 : longitude,
    (extent.north + extent.south) / 2 - point.z / scale,
  ];
}
function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0])
      inside = !inside;
  }
  return inside;
}
export function insideRegion(point) {
  const coordinates = unproject(point);
  return data.region.geometry.coordinates.some(
    (rings) =>
      inRing(coordinates, rings[0]) && !rings.slice(1).some((hole) => inRing(coordinates, hole)),
  );
}
export const city = project(data.place.coordinates, REGION_LIFT);
const countryPoints = data.geometry.coordinates.flat(2).map((p) => project(p));
const regionPoints = data.region.geometry.coordinates.flat(2).map((p) => project(p, REGION_LIFT));
export const countryBounds = new T.Box3().setFromPoints(countryPoints);
export const regionBounds = new T.Box3().setFromPoints(regionPoints);
export const referenceScale = countryBounds.getBoundingSphere(new T.Sphere()).radius;
export function localBounds(width, height, depth, center = city) {
  return new T.Box3().setFromCenterAndSize(center, new T.Vector3(width, height, depth));
}

/** Contours and holes keep the source coordinates. Region elevation is a presentation transform. */
function land(view, geometry, origin, pigment, thickness = 0) {
  const group = new T.Group(),
    top = [],
    sides = [];
  group.position.copy(origin);
  const triangle = (list, a, b, c) => list.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  for (const polygon of geometry.coordinates) {
    const rings = polygon.map((ring) => {
      const points = ring.map((p) => project(p).sub(origin));
      if (points[0].distanceToSquared(points.at(-1)) < 1e-16) points.pop();
      return points;
    });
    const contour = rings[0].map((p) => new T.Vector2(p.x, p.z));
    const holes = rings.slice(1).map((r) => r.map((p) => new T.Vector2(p.x, p.z)));
    const vertices = rings.flat();
    for (const [a, b, c] of T.ShapeUtils.triangulateShape(contour, holes)) {
      const points = [vertices[a], vertices[b], vertices[c]];
      const normal =
        (points[1].z - points[0].z) * (points[2].x - points[0].x) -
        (points[1].x - points[0].x) * (points[2].z - points[0].z);
      if (normal < 0) [points[1], points[2]] = [points[2], points[1]];
      triangle(top, ...points);
    }
    for (const ring of rings) {
      const line = new T.LineLoop(
        new T.BufferGeometry().setFromPoints(ring),
        view.ink(new T.LineBasicMaterial({ depthWrite: false }), 'muted'),
      );
      group.add(line);
      if (thickness)
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i],
            b = ring[(i + 1) % ring.length],
            c = a.clone();
          c.y -= thickness;
          const d = b.clone();
          d.y -= thickness;
          triangle(sides, a, b, c);
          triangle(sides, c, b, d);
        }
    }
  }
  for (const [positions, tone, amount] of [
    [top, pigment, 0.13],
    [sides, pigment, 0.3],
  ]) {
    if (!positions.length) continue;
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.computeVertexNormals();
    const material = view.ink(
      new T.MeshBasicMaterial({
        side: T.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
      }),
      (p) => p.surface.clone().lerp(p[tone], amount),
    );
    group.add(new T.Mesh(g, material));
  }
  return group;
}
export function countryDrawing(view) {
  const root = new T.Group();
  root.name = 'geographic-country';
  const country = land(view, data.geometry, new T.Vector3(), 'blue');
  root.add(country);
  // Construct local geometry at ground level, then move the exact region contour as one object.
  const origin = regionBounds.getCenter(new T.Vector3());
  origin.y = 0;
  const region = land(view, data.region.geometry, origin, 'green', 0.08);
  root.add(region);
  return { root, country, region, origin };
}
