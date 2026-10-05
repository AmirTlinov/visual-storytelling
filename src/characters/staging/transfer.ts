import type { Actor, Point } from '../types.js';
import type { Placement } from './blocking.js';
import type { BipedRig, Furniture, GroundPoint, Staging } from './types.js';
import { project, distance } from './space.js';
import { footprint, supportPoint } from './objects.js';
import { furnitureParts } from './furniture.js';
import { route } from './navigation.js';
import { bookHands, bookHandsOrder } from './book.js';
import { notebookFaces, notebookParts } from './notebook.js';
import { portableBounds } from './portable.js';

type Side = 'left' | 'right';
type Interval = readonly [number, number];
const intersect = (a: Interval[], b: Interval[]) =>
  a.flatMap(([l, r]) =>
    b.flatMap(([x, y]): Interval[] =>
      Math.max(l, x) <= Math.min(r, y) ? [[Math.max(l, x), Math.min(r, y)]] : [],
    ),
  );

/** Solve the actual resting grips against the measured arms, then route to a clear stance. */
export function transferApproach(
  staging: Staging,
  actor: Actor,
  before: Placement,
  item: Furniture & { id: string },
  rig: BipedRig,
  preferredHand?: Side,
) {
  const head = rig.faceBounds?.[actor.skin];
  if (!rig.reach || !head)
    throw new Error('Transfer needs measured rig geometry; rebuild the character pack');
  const space = staging.projection,
    target = project(space, item.at),
    itemScale = target.scale * (item.scale ?? 0.72),
    actorScale = actor.scale ?? 0.77,
    mirror = actor.flip ? -1 : 1,
    floor = before.at.height ?? 0;
  let grips: Point[], contactHeight: number;
  let front = item.at.z,
    back = item.at.z;
  if (item.kind === 'book') {
    const faces = notebookFaces(item, space),
      cover = faces.find((face) => face.name === 'cover')!;
    contactHeight = cover.world[0]!.height ?? 0;
    front = Math.min(...cover.world.map((point) => point.z));
    back = Math.max(...cover.world.map((point) => point.z));
    const hands = bookHands({
      id: '',
      x: target.x,
      y: target.y,
      scale: itemScale,
      open: item.open ?? 0,
      turn: 0,
      handTurn: 0,
      color: '',
      resting: { faces, weight: 1 },
    });
    grips = [hands.left, hands.right];
  } else {
    contactHeight = (item.at.height ?? 0) - (item.art!.grip.y * (item.scale ?? 0.72)) / space.unit;
    grips = [
      { x: target.x + item.art!.grip.x * itemScale, y: target.y + item.art!.grip.y * itemScale },
    ];
  }
  const sides: Side[][] =
    item.kind === 'book'
      ? [
          [
            ...bookHandsOrder(
              rig.reach.left.shoulder.x * mirror,
              rig.reach.right.shoulder.x * mirror,
            ),
          ],
        ]
      : (preferredHand ? [preferredHand] : (['left', 'right'] as Side[])).map((side) => [side]);
  const radius = actorScale * 0.46;
  const reachDepth = (Math.min(rig.reach.left.max, rig.reach.right.max) * actorScale) / 100;
  const depths = new Set([before.at.z, item.at.z - reachDepth, item.at.z, item.at.z + reachDepth]);
  const objectBounds =
    item.kind === 'book'
      ? notebookParts(item, space)[0]!.bounds
      : portableBounds({ ...target, id: '', portable: true, scale: itemScale }, item.art!);
  // A high contact can fall between furniture edges. Include the projection planes
  // where the shoulder levels with the grip and the face clears the object.
  const level = (nativeHeight: number, y: number) => {
    const numerator =
      space.floor -
      space.horizon -
      floor * space.unit -
      (nativeHeight * actorScale * space.unit) / 100;
    const scale = (y - space.horizon) / numerator;
    if (Number.isFinite(scale) && scale > 0) depths.add(space.distance * (1 / scale - 1));
  };
  for (const hands of sides)
    for (const [i, side] of hands.entries()) level(rig.reach[side].shoulder.height, grips[i]!.y);
  level(head.bottom, objectBounds.y - 2);
  // A cutout actor and its held item share a depth. Prefer the camera side of
  // the support, when reachable, to keep the transfer visible before release.
  let supportDepth = Infinity;
  // Furniture edges supply useful approach planes; the route owns obstacle avoidance.
  for (const [id, object] of Object.entries(staging.objects)) {
    if (id === item.id) continue;
    const box = footprint(object);
    const above = box
      ? item.at.x >= box.left &&
        item.at.x <= box.right &&
        item.at.z >= box.front &&
        item.at.z <= box.back
      : Math.abs(item.at.x - object.at.x) + Math.abs(item.at.z - object.at.z) < 1e-6;
    if (!above) continue;
    if (box) {
      depths.add(box.front - radius);
      depths.add(box.back + radius);
    }
    if (
      (object.support || ['table', 'chair', 'bench'].includes(object.kind)) &&
      Math.abs((supportPoint(object).height ?? 0) - (item.at.height ?? 0)) < 1e-6
    ) {
      const depth =
        object.kind === 'prop'
          ? object.at.z - 0.001
          : Math.min(...furnitureParts(object, space).map((part) => part.depth));
      supportDepth = Math.min(supportDepth, depth);
      depths.add(depth - radius);
    }
  }
  const candidates: {
    at: GroundPoint;
    hand: Side;
    via: GroundPoint[];
    cost: number;
    behindSupport: boolean;
  }[] = [];
  for (const z of depths) {
    // Projection cannot make a distant or over-high object reachable. Native IK
    // stays two-dimensional; these world limits keep its stance local to the contact.
    if (z < front - reachDepth || z > back + reachDepth || z <= -space.distance) continue;
    const base = project(space, { x: 0, z, height: floor }),
      scale = (base.scale * actorScale * space.unit) / 100;
    for (const hands of sides) {
      let intervals: Interval[] = [[-Infinity, Infinity]];
      for (const [i, side] of hands.entries()) {
        const arm = rig.reach[side],
          grip = grips[i]!,
          dy = grip.y - (base.y - arm.shoulder.height * scale),
          max = arm.max * scale,
          min = arm.min * scale,
          center = grip.x - arm.shoulder.x * scale * mirror;
        const vertical = Math.abs(contactHeight - floor - (arm.shoulder.height * actorScale) / 100);
        if (vertical > (arm.max * actorScale) / 100 || Math.abs(dy) >= max) {
          intervals = [];
          break;
        }
        const outer = Math.sqrt(max * max - dy * dy),
          inner = Math.sqrt(Math.max(0, min * min - dy * dy));
        intervals = intersect(intervals, [
          [center - outer, center - inner],
          [center + inner, center + outer],
        ]);
      }
      if (
        base.y - head.bottom * scale > objectBounds.y &&
        base.y - head.top * scale < objectBounds.y + objectBounds.height
      ) {
        const left = (mirror > 0 ? head.left : -head.right) * scale,
          right = (mirror > 0 ? head.right : -head.left) * scale;
        intervals = intersect(intervals, [
          [-Infinity, objectBounds.x - right - 2],
          [objectBounds.x + objectBounds.width - left + 2, Infinity],
        ]);
      }
      for (const [left, right] of intervals) {
        // A single hand approaches from its own side, leaving the object outside the torso.
        const direction = Math.sign(rig.reach[hands[0]!]!.shoulder.x * mirror);
        const root =
          item.kind === 'prop'
            ? direction > 0
              ? left
              : right
            : Math.max(left, Math.min(right, project(space, before.at).x));
        const at = { x: (root - space.center) / (space.unit * base.scale), z, height: floor };
        if (item.kind === 'prop' && (grips[0]!.x - root) * direction <= 0) continue;
        let via: GroundPoint[];
        try {
          via = route(staging, before.at, at, radius);
        } catch {
          continue;
        }
        const path = [before.at, ...via, at];
        const length = path.slice(1).reduce((sum, p, i) => sum + distance(path[i]!, p), 0);
        candidates.push({
          at,
          hand: hands[0]!,
          via,
          cost: length,
          behindSupport: z > supportDepth,
        });
      }
    }
  }
  candidates.sort((a, b) => Number(a.behindSupport) - Number(b.behindSupport) || a.cost - b.cost);
  if (!candidates[0])
    throw new Error(
      `Cannot reach ${item.kind} at height ${item.at.height ?? 0} from floor ${floor}`,
    );
  return candidates[0];
}
