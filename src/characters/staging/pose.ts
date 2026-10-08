import type { CarriedFrame } from './portable.js';
import { Vector3, type Bone } from 'three';
import { boneLength } from '../rig.js';
import { contactRig } from './ik.js';
import type { Actor, Point } from '../types.js';
import type { performance } from '../performance.js';
import type { BipedRig, Projection, GroundPoint, Furniture } from './types.js';
import type { BlockingActor, PairContact } from './blocking.js';
import { ease } from './space.js';
import { project, interpolate, alongPath } from './space.js';
import { bookHands, bookHandsOrder, type BookFrame } from './book.js';
import { pressTravel } from './press.js';

type Performer = ReturnType<typeof performance>;
const sides = ['left', 'right'] as const;
type Side = (typeof sides)[number];
const vector = new Vector3();
/** Feet rest on tread centers. The root follows the slope while each foot lifts over risers. */
function stairContact(travel: NonNullable<BlockingActor['travel']>, progress: number): GroundPoint {
  const count = travel.steps!,
    index = Math.round(progress * count);
  if (index === 0) return { ...travel.from };
  if (index === count) return { ...travel.to };
  const ascending = (travel.to.height ?? 0) > (travel.from.height ?? 0);
  const contact = interpolate(travel.from, travel.to, progress);
  contact.z =
    travel.from.z + ((travel.to.z - travel.from.z) * (index + (ascending ? -0.5 : 0.5))) / count;
  return contact;
}
/** Bind once to the rig; all scene actions work in semantic contacts and ground coordinates. */
export function body(
  perf: Performer,
  actor: Actor,
  rig: BipedRig,
  space: Projection,
  height: number,
) {
  const object = perf.object;
  const bone = (name: string) => {
    const b = perf.bones.get(name);
    if (!b) throw new Error(`Missing biped bone: ${name}`);
    return b;
  };
  const hips = bone(rig.hips),
    torso = bone(rig.torso),
    face = bone(rig.face),
    head = rig.head ? bone(rig.head) : undefined;
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
  const stance = Object.fromEntries(sides.map((side) => [side, feet[side].position.x])) as Record<
    Side,
    number
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
  const ik = contactRig(
    perf,
    {
      'arm-left': arms.left,
      'arm-right': arms.right,
      'leg-left': legs.left,
      'leg-right': legs.right,
    },
    height,
  );
  const footTargets = new Map<Side, Point>();
  const end = (side: Side) => ik.point(`arm-${side}`);
  const shoulder = (side: Side) => perf.point(arms[side].upper);
  function reach(side: Side, target: Point, weight: number, kind: string) {
    if (weight <= 0) return;
    ik.solve(`arm-${side}`, target, weight, kind === 'press' ? 1 : -1);
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
    footTargets.set(side, target);
  }
  function look(state: BlockingActor) {
    if (!state.gaze || !head || state.facing === 'back') return;
    const target = project(space, state.gaze.at),
      origin = perf.point(face);
    const dx = target.x - origin.x,
      dy = origin.y - target.y;
    // Tilt the whole head while preserving the body's native or planned action.
    const tilt = (Math.atan2(dy, Math.max(40 * scale, Math.abs(dx))) * 180) / Math.PI;
    head.rotation.z +=
      (Math.max(-18, Math.min(18, tilt)) *
        (dx < 0 ? -1 : 1) *
        (actor.flip ? -1 : 1) *
        state.gaze.weight *
        Math.PI) /
      180;
    object.updateMatrixWorld(true);
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
      return (boneLength(arms[side].upper) + boneLength(arms[side].lower)) * scale * 0.98;
    },
    sample(time: number, state: BlockingActor, reduced: boolean) {
      frame = state;
      at = project(space, state.at);
      scale = (at.scale * (actor.scale ?? 0.77) * space.unit) / 100;
      contacts.length = 0;
      const constrained =
        state.travel ||
        state.seated > 0 ||
        state.holding ||
        state.reaches ||
        state.transfer ||
        state.contact ||
        state.facing !== 'front';
      const action = perf.sample(time, reduced, {
        at,
        scale,
        clip: constrained ? rig.views[state.facing] : undefined,
        mood: state.mood,
        moodTime: state.moodTime,
        view: state.facing,
      });
      if (rig.shadow) perf.hideSlot(rig.shadow);
      footTargets.clear();
      if (!constrained) {
        look(state);
        return action;
      }
      // Seat height belongs to the furniture, not to a hand-tuned actor pose.
      const restingHips = hips.position.y;
      hips.position.y +=
        ((state.seatHeight * 100) / (actor.scale ?? 0.77) + 9 - restingHips) * state.seated;
      for (const side of sides) legs[side].upper.scale.x *= 1 - state.seated * 0.52;
      const travel = state.travel;
      if (travel && travel.length > 0.001 && !reduced) {
        const depthStep = state.facing === 'front' || state.facing === 'back';
        const count =
          (travel.steps ? travel.steps + 1 : undefined) ??
          Math.max(
            2,
            Math.ceil(travel.length / ((travel.running ? 0.5 : 0.32) * (actor.scale ?? 0.77)) / 2) *
              2,
          );
        const phase = travel.progress * count;
        const activity = ease(travel.progress / 0.07) * (1 - ease((travel.progress - 0.93) / 0.07));
        hips.position.y -= activity * (depthStep ? 1.5 : 7 + 4 * Math.sin(phase * Math.PI) ** 2);
        torso.rotation.z +=
          ((Math.sin(phase * Math.PI) * 1.3 +
            (travel.running ? (state.facing === 'right' ? -8 : 8) : 0)) *
            activity *
            Math.PI) /
          180;
        for (const [index, side] of sides.entries()) {
          const step = Math.floor(Math.max(0, phase - index) / 2) * 2 + index;
          const swing = ease((phase - step) / 0.72);
          const from =
            step === index
              ? 0
              : Math.min(1, travel.steps ? (step - 1) / travel.steps : step / count);
          const to = Math.min(1, travel.steps ? (step + 1) / travel.steps : (step + 2) / count);
          const progress = phase < index ? 0 : from + (to - from) * swing;
          let point = travel.path
            ? alongPath(travel.path, progress)
            : interpolate(travel.from, travel.to, progress);
          const base = { x: stance[side] };
          point.x += ((base.x * (actor.scale ?? 0.77)) / 100) * (actor.flip ? -1 : 1);
          if (travel.steps && phase >= index) {
            const start = stairContact(travel, from),
              end = stairContact(travel, to);
            point = interpolate(start, end, ease((swing - 0.18) / 0.65));
            point.x += ((base.x * (actor.scale ?? 0.77)) / 100) * (actor.flip ? -1 : 1);
            const top = Math.max(start.height ?? 0, end.height ?? 0) + 0.12 * (actor.scale ?? 0.77);
            point.height =
              swing < 0.3
                ? (start.height ?? 0) + (top - (start.height ?? 0)) * ease(swing / 0.3)
                : top + ((end.height ?? 0) - top) * ease((swing - 0.7) / 0.3);
          } else {
            point.height =
              (point.height ?? 0) +
              Math.sin(Math.PI * swing) *
                (depthStep ? (travel.running ? 0.18 : 0.12) : travel.running ? 0.36 : 0.24) *
                (actor.scale ?? 0.77);
          }
          const target = project(space, point);
          foot(side, target);
          arms[side].upper.rotation.z +=
            (Math.sin(phase * Math.PI + index * Math.PI) * 13 * activity * Math.PI) / 180;
        }
      } else {
        for (const side of sides) {
          const b = { x: stance[side] };
          const length =
            ((boneLength(legs[side].upper) * (1 - state.seated * 0.52) +
              boneLength(legs[side].lower)) *
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
      object.updateMatrixWorld(true);
      if (travel && state.seated < 0.01 && (state.facing === 'front' || state.facing === 'back')) {
        // On stairs the pelvis yields to the planted lower foot. Moving only an
        // invisible target would leave a visibly floating ankle.
        let lower = 0;
        for (const [side, target] of footTargets) {
          const hip = perf.point(legs[side].upper);
          const length = (boneLength(legs[side].upper) + boneLength(legs[side].lower)) * scale;
          const vertical = Math.sqrt(Math.max(0, (length * 0.985) ** 2 - (target.x - hip.x) ** 2));
          lower = Math.max(lower, target.y - hip.y - vertical);
        }
        hips.position.y -= lower / scale;
        object.updateMatrixWorld(true);
        for (const [side, target] of footTargets) {
          const leg = legs[side],
            hip = perf.point(leg.upper);
          const length = (boneLength(leg.upper) + boneLength(leg.lower)) * scale;
          const factor = Math.max(
            0.4,
            Math.min(1, Math.hypot(target.x - hip.x, target.y - hip.y) / (length * 0.985)),
          );
          // Uniform depth foreshortening preserves the metric assumptions of CCD.
          leg.upper.parent!.scale.multiplyScalar(factor);
        }
        object.updateMatrixWorld(true);
      }
      look(state);
      for (const [side, target] of footTargets) ik.solve(`leg-${side}`, target, 1, 1);
      if (state.facing === 'back') for (const name of rig.faceSlots) perf.hideSlot(name);
      for (const gesture of state.reaches ?? []) {
        const target = project(space, gesture.at);
        reach(
          gesture.side ??
            (state.holding && state.hands === 1
              ? state.holdingHand === 'left'
                ? 'right'
                : 'left'
              : this.sideToward(target)),
          { x: target.x, y: target.y + gesture.press * pressTravel * scale },
          gesture.weight,
          gesture.gesture ?? 'point',
        );
      }
      return action;
    },
    carry(
      id: string,
      art: NonNullable<Furniture['art']>,
      placement?: { x: number; y: number; scale: number; weight: number; grip: number },
    ): CarriedFrame {
      const side = frame.holdingHand ?? 'left',
        hand = shoulder(side);
      const root = hips.localToWorld(vector.set(0, 27, 0));
      const item: CarriedFrame = {
        id,
        portable: true,
        x: hand.x - art.grip.x * scale,
        y: height - root.y - art.grip.y * scale,
        scale,
      };
      if (placement) {
        item.x += (placement.x - item.x) * placement.weight;
        item.y += (placement.y - item.y) * placement.weight;
        item.scale += (placement.scale - item.scale) * placement.weight;
      }
      reach(
        side,
        { x: item.x + art.grip.x * item.scale, y: item.y + art.grip.y * item.scale },
        placement?.grip ?? 1,
        'carry',
      );
      return item;
    },
    book(
      id: string,
      color: string,
      open: number,
      placement?: {
        x: number;
        y: number;
        scale: number;
        weight: number;
        grip: number;
        resting: NonNullable<BookFrame['resting']>['faces'];
      },
    ): BookFrame {
      const p = hips.localToWorld(vector.set(0, 27, 0));
      const book: BookFrame = {
        id,
        x: p.x,
        y: height - p.y,
        scale,
        turn: frame.turn ?? 0,
        open,
        handTurn: frame.handTurn ?? 0,
        color,
      };
      if (placement) {
        book.x += (placement.x - book.x) * placement.weight;
        book.y += (placement.y - book.y) * placement.weight;
        book.scale += (placement.scale - book.scale) * placement.weight;
        book.resting = { faces: placement.resting, weight: placement.weight };
      }
      const hands = bookHands(book);
      const [left, right] = bookHandsOrder(shoulder('left').x, shoulder('right').x);
      reach(left, hands.left, placement?.grip ?? frame.bookBlend ?? 1, 'page');
      reach(right, hands.right, placement?.grip ?? frame.bookBlend ?? 1, 'book-support');
      return book;
    },
    dispose: () => ik.dispose(),
    snapshot: () => ({
      at: frame.at,
      facing: frame.facing,
      seated: frame.seated,
      contacts: structuredClone(contacts),
      feet: Object.fromEntries(sides.map((s) => [s, ik.point(`leg-${s}`)])),
    }),
  };
}
export type Body = ReturnType<typeof body>;
/** One shared target for both hands. Reachability is determined by the two actual rigs. */
export function connect(bodies: Record<string, Body>, pair: PairContact) {
  const [a, b] = pair.actors.map((id) => bodies[id]!);
  const freeSide = (body: Body, target: Point): Side =>
    body.frame.holding && body.frame.hands === 1
      ? body.frame.holdingHand === 'left'
        ? 'right'
        : 'left'
      : body.sideToward(target);
  const sideA = freeSide(a!, b!.shoulder('left')),
    sideB = freeSide(b!, a!.shoulder('right'));
  const sa = a!.shoulder(sideA),
    sb = b!.shoulder(sideB),
    ra = a!.radius(sideA),
    rb = b!.radius(sideB);
  const dx = sb.x - sa.x,
    dy = sb.y - sa.y,
    d = Math.hypot(dx, dy);
  const along = d > 0 ? (ra * ra - rb * rb + d * d) / (2 * d) : 0;
  const cross =
    Math.sqrt(Math.max(0, ra * ra - along * along)) *
    (pair.gesture === 'highFive' ? -0.78 : pair.gesture === 'handTap' ? 0.24 : 0.7);
  const target = {
    x: sa.x + (d ? dx / d : 0) * along - (d ? dy / d : 0) * cross,
    y: sa.y + (d ? dy / d : 0) * along + (d ? dx / d : 0) * cross,
  };
  const kind =
    pair.gesture === 'highFive'
      ? 'high-five'
      : pair.gesture === 'handTap'
        ? 'hand-tap'
        : 'hold-hands';
  a!.reach(sideA, target, pair.weight, kind);
  b!.reach(sideB, target, pair.weight, kind);
}
