import * as T from './engine.js';

export interface FrameAnchor {
  position: T.Vector3;
  /** Half-size of a screen-space annotation, including its breathing room. */
  padding?: readonly [number, number];
}
export interface ReadableFrame {
  center: T.Vector3;
  /** Preserve this aim point; increase distance to fit instead of panning. */
  lockCenter?: boolean;
  direction: T.Vector3;
  width: number;
  height: number;
  insets?: { top?: number; right?: number; bottom?: number; left?: number };
  minimum?: { width: number; height: number };
  anchors?: readonly FrameAnchor[];
}

/** Solve the perspective inequalities for each annotation and the actual usable viewport. */
export function readableFrame(camera: T.PerspectiveCamera, options: ReadableFrame) {
  const { width, height, center } = options;
  const inset = options.insets ?? {};
  const left = inset.left ?? 24,
    right = width - (inset.right ?? 24);
  const top = inset.top ?? 24,
    bottom = height - (inset.bottom ?? 24);
  if (right <= left || bottom <= top)
    throw new Error('A readable frame needs a non-empty viewport');
  const focal = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
  const direction = options.direction.clone().normalize();
  if (!direction.lengthSq()) throw new Error('A frame needs a viewing direction');
  // Match Three's lookAt basis, including a view straight down the up axis.
  const basis = new T.Matrix4().lookAt(direction, new T.Vector3(), camera.up);
  const across = new T.Vector3().setFromMatrixColumn(basis, 0);
  const up = new T.Vector3().setFromMatrixColumn(basis, 1);
  const panX = options.lockCenter ? 0 : (width / 2 - (left + right) / 2) / focal;
  const panY = options.lockCenter ? 0 : ((top + bottom) / 2 - height / 2) / focal;
  const minimum = options.minimum ?? { width: 0.1, height: 0.1 };
  const coordinates = [
    width,
    height,
    focal,
    ...center.toArray(),
    left,
    right,
    top,
    bottom,
    minimum.width,
    minimum.height,
    ...(options.anchors ?? []).flatMap((a) => [...a.position.toArray(), ...(a.padding ?? [])]),
  ];
  if (!coordinates.every(Number.isFinite) || minimum.width <= 0 || minimum.height <= 0)
    throw new Error('A readable frame needs finite coordinates and positive dimensions');
  const anchors = (options.anchors ?? []).map((anchor) => {
    const p = anchor.position.clone().sub(center);
    return {
      x: p.dot(across),
      y: p.dot(up),
      z: p.dot(direction),
      padding: anchor.padding ?? [12, 12],
    };
  });
  for (const x of [-minimum.width / 2, minimum.width / 2])
    for (const y of [-minimum.height / 2, minimum.height / 2])
      anchors.push({ x, y, z: 0, padding: [0, 0] });
  const constraints = anchors.map(({ x, y, z, padding }) => {
    const px = Math.min(padding[0]!, (right - left) * 0.48),
      py = Math.min(padding[1]!, (bottom - top) * 0.48);
    return {
      x,
      y,
      z,
      l: (left + px - width / 2) / focal,
      r: (right - px - width / 2) / focal,
      t: (height / 2 - top - py) / focal,
      b: (height / 2 - bottom + py) / focal,
    };
  });
  // At a fixed distance each anchor permits an interval of camera translations.
  // Their intersection gives the smallest pan needed to preserve the authored composition.
  const intervals = (distance: number) => {
    let loX = -Infinity,
      hiX = Infinity,
      loY = -Infinity,
      hiY = Infinity;
    for (const { x, y, z, l, r, t, b } of constraints) {
      loX = Math.max(loX, x + r * z - distance * (r + panX));
      hiX = Math.min(hiX, x + l * z - distance * (l + panX));
      loY = Math.max(loY, y + t * z - distance * (t + panY));
      hiY = Math.min(hiY, y + b * z - distance * (b + panY));
    }
    const fits = loX <= hiX && loY <= hiY;
    return { loX, hiX, loY, hiY, fits };
  };
  let low = Math.max(
    (minimum.width * focal) / (right - left),
    (minimum.height * focal) / (bottom - top),
    ...anchors.map((a) => a.z + 0.1),
  );
  let distance: number,
    maxDistance = Infinity;
  if (options.lockCenter) {
    // A fixed aim can have an upper as well as a lower distance bound: a label
    // or asymmetric inset may exclude the optical center. Solve that interval
    // directly, including impossible frames, instead of searching indefinitely.
    let high = Infinity;
    const require = (coefficient: number, value: number) => {
      if (coefficient > 0) low = Math.max(low, value / coefficient);
      else if (coefficient < 0) high = Math.min(high, value / coefficient);
      else if (value > 0) high = -Infinity;
    };
    for (const { x, y, z, l, r, t, b } of constraints) {
      require(r, x + r * z);
      require(-l, -x - l * z);
      require(t, y + t * z);
      require(-b, -y - b * z);
    }
    if (!Number.isFinite(low) || low > high)
      throw new Error('A locked camera target cannot fit these insets and annotations');
    distance = low;
    maxDistance = high;
  } else {
    let high = low;
    while (!intervals(high).fits) high *= 1.5;
    for (let i = 0; i < 18; i++) {
      const mid = (low + high) / 2;
      if (intervals(mid).fits) high = mid;
      else low = mid;
    }
    distance = high;
  }
  const limits = intervals(distance);
  const shiftX = options.lockCenter ? 0 : Math.max(limits.loX, Math.min(limits.hiX, 0));
  const shiftY = options.lockCenter ? 0 : Math.max(limits.loY, Math.min(limits.hiY, 0));
  const target = center
    .clone()
    .addScaledVector(across, distance * panX + shiftX)
    .addScaledVector(up, distance * panY + shiftY);
  // With a fixed aim a padded annotation can also limit how far away the camera may be.
  return { target, position: target.clone().addScaledVector(direction, distance), maxDistance };
}

/** Visible geometry only; hidden future results must not flatten the opening shot. */
export function geometryFrameAnchors(
  objects: readonly T.Object3D[],
  include: (object: T.Object3D) => boolean = () => true,
): FrameAnchor[] {
  const anchors: FrameAnchor[] = [];
  for (const object of objects) {
    object.updateWorldMatrix(true, true);
    object.traverseVisible((node) => {
      if (!(node instanceof T.Mesh || node instanceof T.Line) || !include(node)) return;
      const geometry = node.geometry;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const { min, max } = geometry.boundingBox!;
      for (const x of [min.x, max.x])
        for (const y of [min.y, max.y])
          for (const z of [min.z, max.z])
            anchors.push({ position: node.localToWorld(new T.Vector3(x, y, z)) });
    });
  }
  return anchors;
}
