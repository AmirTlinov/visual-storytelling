import type { Furniture, GroundPoint, Projection } from './types.js';
import { projectedParts, type WorldPath } from './geometry.js';

/** One entrance owns the opening, hinge, handle, room and passage clearance. */
export const doorway = {
  width: 3.2,
  height: 4.8,
  wallWidth: 7,
  wallHeight: 6.25,
  reveal: 0.35,
  roomDepth: 3.8,
  handleX: 2.76,
  handleHeight: 1.62,
  swing: Math.PI * 0.47,
} as const;

export function doorPoint(item: Furniture, x: number, height: number, depth: number): GroundPoint {
  const s = item.scale ?? 1;
  return {
    x: item.at.x + x * s,
    z: item.at.z + depth * s,
    height: (item.at.height ?? 0) + height * s,
  };
}
export function doorHandle(item: Furniture, open: number): GroundPoint {
  const angle = -open * doorway.swing;
  return doorPoint(
    item,
    -doorway.width / 2 + doorway.handleX * Math.cos(angle),
    doorway.handleHeight,
    doorway.handleX * Math.sin(angle),
  );
}
/** Pull from the free edge, outside the leaf's swept area. */
export function doorApproach(item: Furniture, scale: number, open = 0): GroundPoint {
  const handle = doorHandle(item, open);
  return { x: handle.x + 0.88 * scale, z: handle.z - 0.72 * scale, height: item.at.height ?? 0 };
}
export function doorPassage(item: Furniture, side: 'inside' | 'outside'): GroundPoint {
  return doorPoint(item, 0, 0, side === 'inside' ? 1.7 : -doorway.width - 0.85);
}
export function doorWaypoint(item: Furniture, side: 'inside' | 'outside'): GroundPoint {
  return doorPoint(item, 0, 0, side === 'inside' ? -0.85 : 0.75);
}

const quad = (
  path: WorldPath,
  x: number,
  y: number,
  w: number,
  h: number,
  z: number,
  fill: string,
  stroke = 2.5,
) =>
  path(
    [
      [x, y, z],
      [x + w, y, z],
      [x + w, y + h, z],
      [x, y + h, z],
    ],
    fill,
    stroke,
  );

export function doorwayParts(item: Furniture, space: Projection, open?: number) {
  const { parts, group } = projectedParts(item, space),
    d = doorway,
    w = d.width / 2,
    wall = d.wallWidth / 2,
    wood = item.color ?? '#537d77',
    plaster = item.facade?.wall ?? '#cebd97',
    room = item.facade?.inside ?? '#8faba4';
  if (open !== undefined) {
    const angle = -open * d.swing,
      cs = Math.cos(angle),
      sn = Math.sin(angle);
    group(sn * w, (path) => {
      const panel = (
        x: number,
        y: number,
        width: number,
        height: number,
        fill: string,
        depth = 0,
        stroke = 2.5,
      ) =>
        path(
          [
            [x, y, depth],
            [x + width, y, depth],
            [x + width, y + height, depth],
            [x, y + height, depth],
          ].map(([x, y, z]) => [-w + x! * cs - z! * sn, y!, x! * sn + z! * cs]),
          fill,
          stroke,
        );
      let svg = panel(0, 0, d.width, d.height, wood);
      svg += panel(0.14, 0.14, d.width - 0.28, d.height - 0.28, '#71978b');
      svg += panel(0.32, 0.35, d.width - 0.64, 1.03, '#53776d');
      svg += panel(0.4, 0.44, d.width - 0.8, 0.83, '#6d9182', 0, 1.5);
      svg += panel(0.32, 2.02, d.width - 0.64, 2.37, '#bdcbbb');
      svg += panel(0.44, 2.15, d.width - 0.88, 2.12, '#d7dec5', 0, 1.5);
      svg += panel(0.42, 3.18, d.width - 0.84, 0.09, wood, 0, 1);
      svg += panel(d.width / 2 - 0.045, 2.13, 0.09, 2.2, wood, 0, 1);
      svg += panel(d.handleX - 0.08, d.handleHeight - 0.19, 0.16, 0.39, '#c4a15b', -0.04, 1.4);
      svg += panel(d.handleX - 0.24, d.handleHeight - 0.03, 0.3, 0.09, '#eed293', -0.08, 1.4);
      // Visible leaf thickness rotates with the same hinge.
      svg += path(
        [
          [0, 0, 0],
          [0, d.height, 0],
          [0, d.height, 0.085],
          [0, 0, 0.085],
        ].map(([x, y, z]) => [-w + x! * cs - z! * sn, y!, x! * sn + z! * cs]),
        '#385f5a',
        1.8,
      );
      return svg;
    });
    return parts;
  }
  // A lit room replaces the painted black rectangle. Its floor continues the courtyard plane.
  group(d.roomDepth, (path) => {
    let svg = quad(path, -w, 0, d.width, d.height, d.roomDepth, room);
    svg += quad(path, -0.93, 1.55, 1.7, 2.65, d.roomDepth - 0.015, '#536e68');
    svg += quad(path, -0.8, 1.7, 1.44, 2.36, d.roomDepth - 0.025, '#f1dfaf', 1.4);
    svg += quad(path, -0.1, 1.72, 0.08, 2.32, d.roomDepth - 0.03, '#a68e68', 0);
    svg += quad(path, -0.8, 2.85, 1.44, 0.08, d.roomDepth - 0.03, '#a68e68', 0);
    svg += path(
      [
        [-w, 0, 0],
        [w, 0, 0],
        [w, 0, d.roomDepth],
        [-w, 0, d.roomDepth],
      ],
      '#c5b08a',
    );
    for (let z = 0.55; z < d.roomDepth; z += 0.65)
      svg += path(
        [
          [-w, 0, z],
          [w, 0, z],
          [w, 0, z + 0.017],
          [-w, 0, z + 0.017],
        ],
        '#a58f71',
        0,
      );
    svg += path(
      [
        [0.2, 0.004, d.roomDepth],
        [-0.6, 0.004, 1.05],
        [1.32, 0.004, 0.22],
        [w, 0.004, 2.2],
      ],
      '#e1c895',
      0,
    );
    svg += path(
      [
        [-w, 0, 0],
        [-w, 0, d.roomDepth],
        [-w, d.height, d.roomDepth],
        [-w, d.height, 0],
      ],
      '#6d8e84',
    );
    svg += path(
      [
        [w, 0, 0],
        [w, 0, d.roomDepth],
        [w, d.height, d.roomDepth],
        [w, d.height, 0],
      ],
      '#a7b9a1',
    );
    svg += path(
      [
        [-w, d.height, 0],
        [w, d.height, 0],
        [w, d.height, d.roomDepth],
        [-w, d.height, d.roomDepth],
      ],
      '#d5c9a9',
    );
    return svg;
  });
  // Exterior has a real aperture: three wall pieces, never a filled rectangle in front of the actor.
  group(-0.04, (path) => {
    let svg =
      quad(path, -wall, 0, wall - w, d.wallHeight, 0, plaster) +
      quad(path, w, 0, wall - w, d.wallHeight, 0, plaster) +
      quad(path, -w, d.height, d.width, d.wallHeight - d.height, 0, plaster);
    for (const x of [-wall, w + 0.2])
      svg += quad(path, x, 0, wall - w - 0.2, 0.5, -0.025, '#a29c82', 1.8);
    for (const x of [-2.92, 2.14]) {
      svg += quad(path, x, 2.25, 0.76, 2.1, -0.035, '#486c67');
      svg += quad(path, x + 0.1, 2.37, 0.56, 1.83, -0.04, '#b7c9b2', 1.4);
      svg += quad(path, x + 0.1, 3.24, 0.56, 0.08, -0.05, '#637d68', 0);
      svg += quad(path, x - 0.12, 2.13, 1, 0.12, -0.11, '#e0d0a6', 1.5);
    }
    // Stone reveal and jambs disclose wall thickness at the threshold.
    svg += path(
      [
        [-w, 0, -0.045],
        [-w, 0, d.reveal],
        [-w, d.height, d.reveal],
        [-w, d.height, -0.045],
      ],
      '#a88f6c',
    );
    svg += path(
      [
        [w, 0, -0.045],
        [w, 0, d.reveal],
        [w, d.height, d.reveal],
        [w, d.height, -0.045],
      ],
      '#ded0aa',
    );
    svg += path(
      [
        [-w, 0, -0.27],
        [w, 0, -0.27],
        [w, 0, d.reveal],
        [-w, 0, d.reveal],
      ],
      '#d7cba9',
      1.8,
    );
    for (const x of [-w - 0.18, w]) svg += quad(path, x, 0, 0.18, d.height + 0.2, -0.06, '#e3d3ab');
    svg += quad(path, -w - 0.18, d.height, d.width + 0.36, 0.2, -0.06, '#e3d3ab');
    svg += quad(path, -1.19, 5.22, 2.38, 0.55, -0.055, '#738a75', 1.8);
    for (const x of [-0.8, -0.4, 0, 0.4, 0.8])
      svg += quad(path, x, 5.43, 0.12, 0.12, -0.06, '#d6c697', 0);
    // Cornice and shallow roof share the facade's world vertices.
    svg += quad(path, -wall - 0.16, d.wallHeight, 2 * wall + 0.32, 0.15, -0.12, '#dfcda4', 2);
    svg += path(
      [
        [-wall - 0.2, d.wallHeight + 0.15, -0.18],
        [wall + 0.2, d.wallHeight + 0.15, -0.18],
        [wall + 0.1, d.wallHeight + 0.5, 1.3],
        [-wall - 0.1, d.wallHeight + 0.5, 1.3],
      ],
      '#5f7b70',
    );
    return svg;
  });
  return parts;
}
