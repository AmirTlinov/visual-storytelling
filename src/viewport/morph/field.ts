/** Signed distance in scene units: negative inside, positive outside. */
export type VolumeField = (x: number, y: number, z: number) => number;
export type VolumePoint = readonly [number, number, number];
export interface VolumePose {
  position?: VolumePoint;
  /** Euler angles in radians, applied in XYZ order. */
  rotation?: VolumePoint;
  scale?: number;
}
export interface VolumeFrame {
  sources: readonly VolumePose[];
  target?: VolumePose;
  morph: number;
  /** Radius of the contact bridge, in scene units. */
  tension?: number;
}

function positive(...values: number[]) {
  if (values.some((n) => !Number.isFinite(n) || n <= 0))
    throw new Error('Volume dimensions must be positive and finite');
}

export function volumeBox(size: VolumePoint, rounding = 0): VolumeField {
  positive(...size);
  if (!Number.isFinite(rounding) || rounding < 0 || rounding > Math.min(...size) / 2)
    throw new Error('Rounding must fit inside the box');
  const [a, b, c] = size.map((n) => n / 2 - rounding);
  return (x, y, z) => {
    const qx = Math.abs(x) - a!,
      qy = Math.abs(y) - b!,
      qz = Math.abs(z) - c!;
    const ox = Math.max(qx, 0),
      oy = Math.max(qy, 0),
      oz = Math.max(qz, 0);
    return Math.sqrt(ox * ox + oy * oy + oz * oz) + Math.min(Math.max(qx, qy, qz), 0) - rounding;
  };
}

export function volumeSphere(radius: number): VolumeField {
  positive(radius);
  return (x, y, z) => Math.sqrt(x * x + y * y + z * z) - radius;
}

/** Capsule along X; length includes its two round ends. */
export function volumeCapsule(radius: number, length: number): VolumeField {
  positive(radius, length);
  if (length < 2 * radius) throw new Error('Capsule length must contain its round ends');
  const half = length / 2 - radius;
  return (x, y, z) => {
    const dx = x - Math.max(-half, Math.min(half, x));
    return Math.sqrt(dx * dx + y * y + z * z) - radius;
  };
}

function placement(field: VolumeField) {
  let px = 0,
    py = 0,
    pz = 0,
    scale = 1;
  const matrix = new Float64Array(9);
  let rotated = false,
    inverseScale = 1;
  return {
    update(pose: VolumePose = {}) {
      const p = pose.position ?? [0, 0, 0],
        r = pose.rotation ?? [0, 0, 0];
      scale = pose.scale ?? 1;
      positive(scale);
      if ([...p, ...r].some((n) => !Number.isFinite(n)))
        throw new Error('Volume poses must be finite');
      [px, py, pz] = p;
      inverseScale = 1 / scale;
      rotated = r.some((n) => n !== 0);
      const cx = Math.cos(r[0]),
        sx = Math.sin(r[0]),
        cy = Math.cos(r[1]),
        sy = Math.sin(r[1]),
        cz = Math.cos(r[2]),
        sz = Math.sin(r[2]);
      matrix.set([
        cy * cz,
        -cy * sz,
        sy,
        sx * sy * cz + cx * sz,
        -sx * sy * sz + cx * cz,
        -sx * cy,
        -cx * sy * cz + sx * sz,
        cx * sy * sz + sx * cz,
        cx * cy,
      ]);
    },
    distance(x: number, y: number, z: number) {
      x = (x - px) * inverseScale;
      y = (y - py) * inverseScale;
      z = (z - pz) * inverseScale;
      if (!rotated) return field(x, y, z) * scale;
      return (
        field(
          matrix[0]! * x + matrix[3]! * y + matrix[6]! * z,
          matrix[1]! * x + matrix[4]! * y + matrix[7]! * z,
          matrix[2]! * x + matrix[5]! * y + matrix[8]! * z,
        ) * scale
      );
    },
  };
}

/** One scalar surface for all suppliers and the result; no overlapping mesh shells. */
export function volumeField(sources: readonly VolumeField[], target: VolumeField) {
  if (!sources.length) throw new Error('Volume morph needs at least one source');
  const inputs = sources.map(placement),
    destination = placement(target);
  const contacts = sources.slice(1).map(() => new Float64Array(6));
  let morph = 0,
    tension = 0;
  return {
    update(frame: VolumeFrame) {
      if (frame.sources.length !== inputs.length)
        throw new Error('Volume source poses do not match shapes');
      if (!Number.isFinite(frame.morph) || !Number.isFinite(frame.tension ?? 0.2))
        throw new Error('Volume progress and tension must be finite');
      morph = Math.max(0, Math.min(1, frame.morph));
      tension = Math.max(0, frame.tension ?? 0.2) * (1 - morph);
      inputs.forEach((source, i) => source.update(frame.sources[i]));
      destination.update(frame.target);
      let [ax, ay, az] = frame.sources[0]!.position ?? [0, 0, 0];
      contacts.forEach((contact, i) => {
        const [bx, by, bz] = frame.sources[i + 1]!.position ?? [0, 0, 0];
        const dx = bx - ax,
          dy = by - ay,
          dz = bz - az,
          length = Math.hypot(dx, dy, dz) || 1;
        contact.set([
          (ax + bx) / 2,
          (ay + by) / 2,
          (az + bz) / 2,
          dx / length,
          dy / length,
          dz / length,
        ]);
        ax += (bx - ax) / (i + 2);
        ay += (by - ay) / (i + 2);
        az += (bz - az) / (i + 2);
      });
    },
    distance(x: number, y: number, z: number) {
      if (morph === 1) return destination.distance(x, y, z);
      let distance = inputs[0]!.distance(x, y, z);
      for (let i = 1; i < inputs.length; i++) {
        const next = inputs[i]!.distance(x, y, z);
        const h = tension ? Math.max(0, tension - Math.abs(distance - next)) / tension : 0;
        let bridge = 0;
        if (h) {
          const c = contacts[i - 1]!,
            dx = x - c[0]!,
            dy = y - c[1]!,
            dz = z - c[2]!;
          const along = dx * c[3]! + dy * c[4]! + dz * c[5]!;
          const radial = Math.max(0, dx * dx + dy * dy + dz * dz - along * along);
          // Contact starts near the suppliers' joining axis, even for two flat faces.
          bridge = (h * h * tension * 0.25) / (1 + radial / (4 * tension * tension));
        }
        distance = Math.min(distance, next) - bridge;
      }
      return morph === 0
        ? distance
        : distance * (1 - morph) + destination.distance(x, y, z) * morph;
    },
  };
}
