import {
  IkConstraint,
  Physics,
  ScaleYMode,
  Vector2,
  type Bone,
  type Skeleton,
} from '@esotericsoftware/spine-webgl';
import type { Actor, Point } from '../types.js';
import type { performance } from '../performance.js';
import type { BipedRig, Projection } from './types.js';
import type { BlockingActor, PairContact } from './blocking.js';
import { ease } from './space.js';
import { project, interpolate, alongPath } from './space.js';
import { bookHands, type BookFrame } from './furniture.js';

type Performer = ReturnType<typeof performance>;
const sides = ['left', 'right'] as const;
type Side = (typeof sides)[number];
const vector = new Vector2();
function descendants(bone: Bone, skeleton: Skeleton) {
  bone.appliedPose.updateWorldTransform(skeleton);
  for (const child of bone.children) descendants(child, skeleton);
}
/** Bind once to the rig; all scene actions work in semantic contacts and ground coordinates. */
export function body(
  perf: Performer,
  actor: Actor,
  rig: BipedRig,
  space: Projection,
  height: number,
) {
  const skeleton = perf.skeleton;
  const bone = (name: string) => {
    const b = skeleton.findBone(name);
    if (!b) throw new Error(`Missing biped bone: ${name}`);
    return b;
  };
  const hips = bone(rig.hips),
    torso = bone(rig.torso);
  const arms = Object.fromEntries(
    sides.map((side) => [
      side,
      { upper: bone(rig.arms[side].upper), lower: bone(rig.arms[side].lower) },
    ]),
  ) as Record<Side, { upper: Bone; lower: Bone }>;
  const feet = Object.fromEntries(sides.map((side) => [side, bone(rig.feet[side])])) as Record<
    Side,
    Bone
  >;
  const legs = Object.fromEntries(
    sides.map((side) => [
      side,
      { upper: bone(rig.legs[side].upper), lower: bone(rig.legs[side].lower) },
    ]),
  ) as Record<Side, { upper: Bone; lower: Bone }>;
  let at: ReturnType<typeof project>,
    scale = 1,
    frame: BlockingActor;
  const contacts: { kind: string; side: Side; target: Point; actual: Point; error: number }[] = [];
  const end = (side: Side) => {
    const arm = arms[side].lower;
    const p = arm.appliedPose.localToWorld(vector.set(arm.data.length, 0));
    return { x: p.x, y: height - p.y };
  };
  const shoulder = (side: Side) => ({
    x: arms[side].upper.appliedPose.worldX,
    y: height - arms[side].upper.appliedPose.worldY,
  });
  function reach(side: Side, target: Point, weight: number, kind: string) {
    if (weight <= 0) return;
    const arm = arms[side];
    IkConstraint.apply(
      skeleton,
      arm.upper.appliedPose,
      arm.lower.appliedPose,
      target.x,
      height - target.y,
      -1,
      false,
      ScaleYMode.None,
      0,
      weight,
    );
    descendants(arm.upper, skeleton);
    const actual = end(side);
    contacts.push({
      kind,
      side,
      target,
      actual,
      error: Math.hypot(target.x - actual.x, target.y - actual.y),
    });
  }
  function foot(side: Side, target: Point) {
    const b = feet[side];
    const local = b.appliedPose.worldToParent(vector.set(target.x, height - target.y));
    b.pose.x = local.x;
    b.pose.y = local.y;
  }
  return {
    perf,
    actor,
    get frame() {
      return frame;
    },
    get scale() {
      return scale;
    },
    shoulder,
    end,
    reach,
    sideToward(point: Point): Side {
      return Math.abs(shoulder('left').x - point.x) < Math.abs(shoulder('right').x - point.x)
        ? 'left'
        : 'right';
    },
    radius(side: Side) {
      return (arms[side].upper.data.length + arms[side].lower.data.length) * scale * 0.98;
    },
    sample(time: number, state: BlockingActor, reduced: boolean) {
      frame = state;
      at = project(space, state.at);
      scale = (at.scale * (actor.scale ?? 0.77) * space.unit) / 100;
      contacts.length = 0;
      const constrained =
        state.travel ||
        state.seated > 0 ||
        state.book ||
        state.reach ||
        state.transfer ||
        state.contact ||
        state.facing !== 'front';
      const action = perf.sample(time, reduced, {
        at,
        scale,
        clip: constrained ? rig.views[state.facing] : undefined,
        mood: state.mood,
        view: state.facing,
      });
      if (rig.shadow) {
        const slot = skeleton.findSlot(rig.shadow);
        if (slot) {
          slot.pose.color.a = 0;
          slot.appliedPose.color.a = 0;
        }
      }
      if (!constrained) return action;
      // Seat height belongs to the furniture, not to a hand-tuned actor pose.
      const restingHips = hips.pose.y;
      hips.pose.y +=
        ((state.seatHeight * 100) / (actor.scale ?? 0.77) + 9 - restingHips) * state.seated;
      for (const side of sides) legs[side].upper.pose.scaleX *= 1 - state.seated * 0.52;
      const travel = state.travel;
      if (travel && travel.length > 0.001 && !reduced) {
        const depthStep = state.facing === 'front' || state.facing === 'back';
        const count =
          travel.steps ??
          Math.max(
            2,
            Math.ceil(travel.length / ((travel.running ? 0.5 : 0.32) * (actor.scale ?? 0.77)) / 2) *
              2,
          );
        const phase = travel.progress * count;
        const activity = ease(travel.progress / 0.07) * (1 - ease((travel.progress - 0.93) / 0.07));
        hips.pose.y -= activity * (depthStep ? 1.5 : 7 + 4 * Math.sin(phase * Math.PI) ** 2);
        torso.pose.rotation +=
          (Math.sin(phase * Math.PI) * 1.3 +
            (travel.running ? (state.facing === 'right' ? -8 : 8) : 0)) *
          activity;
        for (const [index, side] of sides.entries()) {
          const step = Math.floor(Math.max(0, phase - index) / 2) * 2 + index;
          const swing = ease((phase - step) / 0.72);
          const from = step === index ? 0 : Math.min(1, step / count);
          const to = Math.min(1, (step + 2) / count);
          const progress = phase < index ? 0 : from + (to - from) * swing;
          const point = travel.path
            ? alongPath(travel.path, progress)
            : interpolate(travel.from, travel.to, progress);
          const base = feet[side].data.setupPose;
          point.x += ((base.x * (actor.scale ?? 0.77)) / 100) * (actor.flip ? -1 : 1);
          point.height =
            (point.height ?? 0) +
            Math.sin(Math.PI * swing) *
              (depthStep ? (travel.running ? 0.18 : 0.12) : travel.running ? 0.36 : 0.24) *
              (actor.scale ?? 0.77);
          const target = project(space, point);
          foot(side, target);
          if (depthStep && state.seated < 0.01) {
            // A knee bends into depth when walking away. Foreshorten the whole leg
            // vertically instead of forcing that bend sideways in the drawing plane.
            const leg = legs[side],
              root = leg.upper.parent!;
            const hipY = leg.upper.appliedPose.worldY + (hips.pose.y - restingHips) * scale;
            const reach = hipY - (height - target.y);
            const length = (leg.upper.data.length + leg.lower.data.length) * scale;
            root.pose.scaleY *= Math.max(0.55, Math.min(1.12, (reach / length) * 1.006));
          }
          arms[side].upper.pose.rotation +=
            Math.sin(phase * Math.PI + index * Math.PI) * 13 * activity;
        }
      } else {
        for (const side of sides) {
          const b = feet[side].data.setupPose;
          const length =
            ((legs[side].upper.data.length * (1 - state.seated * 0.52) +
              legs[side].lower.data.length) *
              (actor.scale ?? 0.77)) /
            100;
          const lift = Math.max(0, state.seatHeight + 0.07 - length * 0.96) * state.seated;
          foot(
            side,
            project(space, {
              ...state.at,
              x: state.at.x + ((b.x * (actor.scale ?? 0.77)) / 100) * (actor.flip ? -1 : 1),
              height: (state.at.height ?? 0) + lift,
            }),
          );
        }
      }
      skeleton.updateWorldTransform(Physics.reset);
      if (state.facing === 'back')
        for (const name of rig.faceSlots) {
          const slot = skeleton.findSlot(name);
          if (slot) {
            slot.pose.color.a = 0;
            slot.appliedPose.color.a = 0;
          }
        }
      if (state.reach) {
        const target = project(space, state.reach.at);
        reach(
          this.sideToward(target),
          { x: target.x, y: target.y + state.reach.press * 4 * scale },
          state.reach.weight,
          'point',
        );
      }
      return action;
    },
    book(
      id: string,
      color: string,
      placement?: { x: number; y: number; scale: number; weight: number; grip: number },
    ): BookFrame {
      const p = hips.appliedPose.localToWorld(vector.set(0, 27));
      const book = {
        id,
        x: p.x,
        y: height - p.y,
        scale,
        turn: frame.turn ?? 0,
        handTurn: frame.handTurn ?? 0,
        color,
      };
      if (placement) {
        book.x += (placement.x - book.x) * placement.weight;
        book.y += (placement.y - book.y) * placement.weight;
        book.scale += (placement.scale - book.scale) * placement.weight;
      }
      const hands = bookHands(book);
      const left = this.sideToward(hands.left),
        right = left === 'left' ? 'right' : 'left';
      reach(left, hands.left, placement?.grip ?? frame.bookBlend ?? 1, 'book-support');
      reach(right, hands.right, placement?.grip ?? frame.bookBlend ?? 1, 'page');
      return book;
    },
    snapshot: () => ({
      at: frame.at,
      facing: frame.facing,
      seated: frame.seated,
      contacts: structuredClone(contacts),
      feet: Object.fromEntries(
        sides.map((s) => [
          s,
          { x: feet[s].appliedPose.worldX, y: height - feet[s].appliedPose.worldY },
        ]),
      ),
    }),
  };
}
export type Body = ReturnType<typeof body>;
/** One shared target for both hands. Reachability is determined by the two actual rigs. */
export function connect(bodies: Record<string, Body>, pair: PairContact) {
  const [a, b] = pair.actors.map((id) => bodies[id]!);
  const sideA = a!.sideToward(b!.shoulder('left')),
    sideB = b!.sideToward(a!.shoulder('right'));
  const sa = a!.shoulder(sideA),
    sb = b!.shoulder(sideB),
    ra = a!.radius(sideA),
    rb = b!.radius(sideB);
  const dx = sb.x - sa.x,
    dy = sb.y - sa.y,
    d = Math.hypot(dx, dy);
  const along = d > 0 ? (ra * ra - rb * rb + d * d) / (2 * d) : 0;
  const cross = Math.sqrt(Math.max(0, ra * ra - along * along)) * (pair.high ? -0.78 : 0.7);
  const target = {
    x: sa.x + (d ? dx / d : 0) * along - (d ? dy / d : 0) * cross,
    y: sa.y + (d ? dy / d : 0) * along + (d ? dx / d : 0) * cross,
  };
  a!.reach(sideA, target, pair.weight, pair.high ? 'high-five' : 'hold-hands');
  b!.reach(sideB, target, pair.weight, pair.high ? 'high-five' : 'hold-hands');
}
