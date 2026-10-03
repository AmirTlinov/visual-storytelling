import * as T from './engine.js';

export interface FrameAnchor {
  position: T.Vector3;
  /** Half-size of a screen-space annotation, including its breathing room. */
  padding?: readonly [number, number];
}
export interface ReadableFrame {
  center: T.Vector3;
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
  const across = camera.up.clone().cross(direction).normalize();
  const up = direction.clone().cross(across).normalize();
  const panX = (width / 2 - (left + right) / 2) / focal;
  const panY = ((top + bottom) / 2 - height / 2) / focal;
  const minimum = options.minimum ?? { width: 0.1, height: 0.1 };
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
  // At a fixed distance each anchor permits an interval of camera translations.
  // Their intersection gives the smallest pan needed to preserve the authored composition.
  const intervals = (distance: number) => {
    let loX = -Infinity,
      hiX = Infinity,
      loY = -Infinity,
      hiY = Infinity;
    for (const { x, y, z, padding } of anchors) {
      const px = Math.min(padding[0]!, (right - left) * 0.48),
        py = Math.min(padding[1]!, (bottom - top) * 0.48);
      const l = (left + px - width / 2) / focal,
        r = (right - px - width / 2) / focal;
      const t = (height / 2 - top - py) / focal,
        b = (height / 2 - bottom + py) / focal;
      loX = Math.max(loX, x + r * z - distance * (r + panX));
      hiX = Math.min(hiX, x + l * z - distance * (l + panX));
      loY = Math.max(loY, y + t * z - distance * (t + panY));
      hiY = Math.min(hiY, y + b * z - distance * (b + panY));
    }
    return { loX, hiX, loY, hiY, fits: loX <= hiX && loY <= hiY };
  };
  let low = Math.max(
    (minimum.width * focal) / (right - left),
    (minimum.height * focal) / (bottom - top),
    ...anchors.map((a) => a.z + 0.1),
  );
  let high = low;
  while (!intervals(high).fits) high *= 1.5;
  for (let i = 0; i < 18; i++) {
    const mid = (low + high) / 2;
    if (intervals(mid).fits) high = mid;
    else low = mid;
  }
  const distance = high,
    limits = intervals(distance);
  const shiftX = Math.max(limits.loX, Math.min(limits.hiX, 0));
  const shiftY = Math.max(limits.loY, Math.min(limits.hiY, 0));
  const target = center
    .clone()
    .addScaledVector(across, distance * panX + shiftX)
    .addScaledVector(up, distance * panY + shiftY);
  return { target, position: target.clone().addScaledVector(direction, distance) };
}

/** Visible geometry only; hidden future results must not flatten the opening shot. */
export function geometryFrameAnchors(objects: readonly T.Object3D[]): FrameAnchor[] {
  const anchors: FrameAnchor[] = [];
  for (const object of objects) {
    object.updateWorldMatrix(true, true);
    object.traverseVisible((node) => {
      if (!(node instanceof T.Mesh)) return;
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
