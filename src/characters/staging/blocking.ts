import { blockAt } from './motion.js';
import { stagingCatalog } from './catalog.js';
import type { CharacterStageOptions } from '../types.js';
import type { Script } from '../../story/cues.js';
import type { ActionChannel, Destination, Facing, GroundPoint, StageAction } from './types.js';
import { stairEnd, objectShape, supportPoint, seatPlaces, triggerPoint } from './objects.js';
import { doorApproach, doorPassage, doorWaypoint } from './doorway.js';
import { distance, interpolate, project, facing } from './space.js';
import { destination } from './layout.js';
import { route, meetingPoint } from './navigation.js';
import { coordinateTraffic } from './traffic.js';
import { pressApproach } from './press.js';
import { propStart } from '../prop-timing.js';
import { transferApproach } from './transfer.js';
import { actionTiming, durationOf, type ActionTiming } from './timing.js';

export interface Placement {
  at: GroundPoint;
  facing: Facing;
  seated: number;
  seatHeight: number;
  seat?: string;
  holding?: string;
  hands?: 1 | 2;
  holdingHand?: 'left' | 'right';
  seatSlot?: number;
}
export interface BlockingActor extends Placement {
  travel?: {
    from: GroundPoint;
    to: GroundPoint;
    progress: number;
    length: number;
    running?: boolean;
    steps?: number;
    path?: GroundPoint[];
  };
  transfer?: { id: string; at: GroundPoint; progress: number; taking: boolean; grip: number };
  contact?: boolean;
  mood?: string;
  moodTime?: number;
  gaze?: { at: GroundPoint; weight: number };
  bookBlend?: number;
  turn?: number;
  handTurn?: number;
  reaches?: {
    at: GroundPoint;
    weight: number;
    press: number;
    gesture?: 'press';
    side?: 'left' | 'right';
  }[];
}
export interface PairContact {
  actors: readonly [string, string];
  weight: number;
  gesture: 'highFive' | 'handTap' | 'walkTogether';
}
export interface Plan {
  start: number;
  end: number;
  action: StageAction;
  from: Record<string, Placement>;
  to: Record<string, Placement>;
  transfer?: { id: string; at: GroundPoint; taking: boolean };
  objectFrom?: number;
  objectTo?: number;
  via?: GroundPoint[];
  approaches?: Record<string, GroundPoint[]>;
  meeting?: GroundPoint;
  doorSide?: 'inside' | 'outside';
  effect?: { id: string; from: number; to: number };
  target?: GroundPoint;
  reachSide?: 'left' | 'right';
  channels: readonly ActionChannel[];
  timing: ActionTiming;
}
export const overlayAction = (action: StageAction) =>
  ['point', 'look', 'mood'].includes(action?.action);
function participants(a: StageAction) {
  if (!a || typeof a !== 'object') throw new Error('A prepared action is required');
  if (['highFive', 'handTap', 'walkTogether'].includes(a.action)) {
    if (!('actors' in a) || !Array.isArray(a.actors) || a.actors.length !== 2 || 'actor' in a)
      throw new Error(`${a.action} needs exactly two actors`);
    return [...a.actors];
  }
  if (!Object.hasOwn(stagingCatalog.actions, a.action))
    throw new Error(`Unknown prepared action: ${a.action}`);
  if (!('actor' in a) || typeof a.actor !== 'string' || 'actors' in a)
    throw new Error(`${a.action} needs one actor`);
  return [a.actor];
}

export function compileBlocking(options: CharacterStageOptions, script?: Script) {
  const staging = options.set.staging;
  const active =
    options.beats.some((b) => b.perform?.length) ||
    Object.values(options.cast).some((actor) => actor.holding !== undefined);
  if (!staging) {
    if (active) throw new Error('Prepared actions need a set with a ground plane and objects');
    return undefined;
  }
  if (!options.pack.rig) throw new Error('Prepared actions need the pack’s semantic biped rig');
  project(staging.projection, { x: 0, z: 0 });
  const point = (to: Destination): GroundPoint => destination(staging, to);
  for (const spot of Object.values(staging.spots)) point(spot);
  for (const [id, support] of Object.entries(staging.supports ?? {})) {
    point(support.at);
    if (![support.width, support.depth].every((n) => Number.isFinite(n) && n > 0))
      throw new Error(`Invalid floor support: ${id}`);
  }
  for (const [id, item] of Object.entries(staging.objects)) {
    if (!stagingCatalog.objects.includes(item.kind))
      throw new Error(`Unknown stage object kind: ${id}`);
    point(item.at);
    if (
      item.kind === 'prop' &&
      (!item.art ||
        ![item.art.width, item.art.height, item.art.grip?.x, item.art.grip?.y].every(
          Number.isFinite,
        ) ||
        item.art.width <= 0 ||
        item.art.height <= 0)
    )
      throw new Error(`Portable object ${id} needs valid artwork and a grip`);
    if (item.support && (!Number.isFinite(item.support.height) || item.support.height < 0))
      throw new Error(`Invalid support: ${id}`);
    for (const seat of item.seats ?? []) point(seat);
    if (item.kind === 'book' && item.trigger)
      throw new Error(`Book ${id} uses opening actions; place its button on a separate prop`);
    if (
      item.trigger &&
      (!['toggle', 'on', 'off'].includes(item.trigger.effect) ||
        ![0, 1].includes(item.trigger.initial ?? 0))
    )
      throw new Error(`Invalid control state: ${id}`);
    if (item.scale !== undefined && (!Number.isFinite(item.scale) || item.scale <= 0))
      throw new Error(`Invalid object scale: ${id}`);
    if (
      item.open !== undefined &&
      (!['door', 'book'].includes(item.kind) ||
        !Number.isFinite(item.open) ||
        item.open < 0 ||
        item.open > 1)
    )
      throw new Error(`Invalid initial opening: ${id}`);
  }
  const initial: Record<string, Placement> = Object.create(null),
    held = new Set<string>();
  for (const [id, a] of Object.entries(options.cast)) {
    if (typeof a.at === 'object' && 'y' in a.at)
      throw new Error(`Actor ${id}: prepared sets use ground coordinates or a named place`);
    if (a.holdingHand !== undefined && !['left', 'right'].includes(a.holdingHand))
      throw new Error(`Actor ${id}: holdingHand must be left or right`);
    initial[id] = {
      at: point(a.at),
      facing: 'front',
      seated: 0,
      seatHeight: 0,
      holding: a.holding,
      hands: a.holding && staging.objects[a.holding]?.kind === 'book' ? 2 : 1,
      holdingHand: a.holdingHand ?? 'left',
    };
    if (a.holding !== undefined) {
      if (
        !Object.hasOwn(staging.objects, a.holding) ||
        !['book', 'prop'].includes(staging.objects[a.holding]?.kind ?? '')
      )
        throw new Error(`Unknown held portable object: ${a.holding}`);
      if (held.has(a.holding)) throw new Error(`Object ${a.holding} already has a holder`);
      held.add(a.holding);
    }
  }
  const initialObjects = Object.fromEntries(
    Object.entries(staging.objects)
      .filter(([, item]) => item.kind === 'door' || item.kind === 'book' || item.trigger)
      .map(([id, item]) => [id, item.trigger?.initial ?? item.open ?? 0]),
  );
  const state = structuredClone(initial),
    plans: Plan[] = [],
    objectStates: Record<string, number> = { ...initialObjects };
  const initialItems = Object.fromEntries(
    Object.entries(staging.objects)
      .filter(([, v]) => v.kind === 'book' || v.kind === 'prop')
      .map(([id, v]) => [id, { ...v.at }]),
  );
  const itemPositions = structuredClone(initialItems);
  const object = (id: string, kind: string[]) => {
    const item = Object.hasOwn(staging.objects, id) ? staging.objects[id] : undefined;
    if (!item || !kind.includes(item.kind))
      throw new Error(`Object ${id} must be ${kind.join(' or ')}`);
    return item;
  };
  const scales = Object.fromEntries(
    Object.entries(options.cast).map(([id, a]) => [id, a.scale ?? 0.77]),
  );
  const cues: Record<string, { start: number; end: number }> = {};
  let cursor = 0;
  for (const beat of options.beats) {
    const before = structuredClone(state),
      firstPlan = plans.length;
    const startingObjects = { ...objectStates };
    const used = new Map<string, Set<ActionChannel>>(),
      usedObjects = new Set<string>();
    const cue = script?.cues[beat.id];
    const start = cue?.start ?? cursor;
    if (script && !cue) throw new Error(`Narration is missing cue: ${beat.id}`);
    // Locomotion first, then independent gesture/gaze/expression overlays. Input order has no effect.
    const actions = [...(beat.perform ?? [])].sort(
      (a, b) => Number(overlayAction(a)) - Number(overlayAction(b)),
    );
    for (const action of actions) {
      const ids = participants(action);
      if (new Set(ids).size !== ids.length)
        throw new Error('An interaction needs distinct participants');
      for (const id of ids) {
        if (!Object.hasOwn(state, id)) throw new Error(`Unknown action participant: ${id}`);
      }
      const from = Object.fromEntries(ids.map((id) => [id, structuredClone(state[id]!)]));
      const to = structuredClone(from);
      let objectFrom: number | undefined,
        objectTo: number | undefined,
        transfer: Plan['transfer'],
        via: Plan['via'],
        meeting: Plan['meeting'];
      let effect: Plan['effect'], target: GroundPoint | undefined, reachSide: Plan['reachSide'];
      let doorSide: Plan['doorSide'];
      const approaches: Record<string, GroundPoint[]> = {};
      let channels: ActionChannel[] = ['locomotion', 'left-hand', 'right-hand'];
      const approach = (id: string, at: GroundPoint) =>
        route(staging, from[id]!.at, at, (options.cast[id]!.scale ?? 0.77) * 0.46);
      if ('actor' in action) {
        const p = to[action.actor]!;
        if (action.action === 'walk' || action.action === 'run' || action.action === 'flee') {
          channels = ['locomotion'];
          if (action.speed !== undefined && (!Number.isFinite(action.speed) || action.speed <= 0))
            throw new Error('Walking speed must be positive metres per second');
        }
        if (action.action === 'point') {
          if (action.hand !== undefined && !['left', 'right'].includes(action.hand))
            throw new Error('A pointing hand must be left or right');
          reachSide =
            action.hand ?? (p.holding ? (p.holdingHand === 'left' ? 'right' : 'left') : 'right');
          if (p.holding && (p.hands === 2 || p.holdingHand === reachSide))
            throw new Error(`Point needs the free ${reachSide} hand of ${action.actor}`);
          channels = [`${reachSide}-hand`];
        }
        if (action.action === 'look') {
          if (!options.pack.rig.head)
            throw new Error('Look needs the semantic head bone; rebuild the character pack');
          channels = ['gaze'];
          target = point(action.target);
        }
        if (action.action === 'mood') {
          channels = ['expression'];
          if (!Object.hasOwn(options.pack.actions, action.name))
            throw new Error(`Unknown mood: ${action.name}`);
          if (beat.actors?.[action.actor] !== undefined)
            throw new Error(`Two expressions own ${action.actor} in beat ${beat.id}`);
        }
        if (
          p.holding &&
          p.hands === 2 &&
          ['point', 'press', 'openDoor', 'closeDoor'].includes(action.action)
        )
          throw new Error(
            `${action.action} needs a free hand; actor ${action.actor} is holding a book`,
          );
        if (action.action === 'take' || action.action === 'put') {
          let id: string, at: GroundPoint;
          if (action.action === 'take') {
            object(action.object, ['book', 'prop']);
            if (action.hand !== undefined && !['left', 'right'].includes(action.hand))
              throw new Error('A taking hand must be left or right');
            id = action.object;
            at = itemPositions[id]!;
            if (p.holding) throw new Error(`Actor ${action.actor} already holds an object`);
            if (Object.values(state).some((actor) => actor.holding === id))
              throw new Error(`Object ${id} already has a holder`);
            p.holding = id;
            p.hands = staging.objects[id]!.kind === 'book' ? 2 : 1;
            p.holdingHand = action.hand ?? options.cast[action.actor]!.holdingHand ?? 'left';
          } else {
            if (!p.holding) throw new Error(`Actor ${action.actor} has no object to put`);
            id = p.holding;
            const support = staging.objects[action.onto];
            if (!support) throw new Error(`Unknown support: ${action.onto}`);
            at = supportPoint(support);
            itemPositions[id] = { ...at };
            p.holding = undefined;
          }
          if (usedObjects.has(id))
            throw new Error(`Two actions own object ${id} in beat ${beat.id}`);
          usedObjects.add(id);
          transfer = { id, at: { ...at }, taking: action.action === 'take' };
          const contact = transferApproach(
            staging,
            options.cast[action.actor]!,
            from[action.actor]!,
            { ...staging.objects[id]!, id, at, open: objectStates[id] },
            options.pack.rig!,
            action.action === 'put'
              ? from[action.actor]!.holdingHand
              : (action.hand ?? options.cast[action.actor]!.holdingHand),
          );
          p.at = point(contact.at);
          p.holdingHand = contact.hand;
          via = contact.via;
          p.facing = 'front';
          p.seated = 0;
          p.seat = undefined;
        }
        if (action.action === 'walk' || action.action === 'run' || action.action === 'flee') {
          p.at = point(action.to);
          if (distance(from[action.actor]!.at, p.at) > 0.001)
            p.facing = facing(from[action.actor]!.at, p.at);
          p.seated = 0;
          p.seat = undefined;
        }
        if (action.action === 'sit' || (action.action === 'read' && action.seat)) {
          const chair = object(action.seat!, ['chair', 'bench']);
          if (p.seat && p.seat !== action.seat)
            throw new Error(`Actor ${action.actor} must stand before changing seats`);
          const places = seatPlaces(chair);
          const occupied = new Set(
            Object.entries(state)
              .filter(
                ([id, actor]) =>
                  id !== action.actor &&
                  actor.seat === action.seat &&
                  !(beat.perform ?? []).some(
                    (a) =>
                      'actor' in a &&
                      a.actor === id &&
                      ['stand', 'walk', 'run', 'flee'].includes(a.action),
                  ),
              )
              .map(([, actor]) => actor.seatSlot ?? 0),
          );
          const slot =
            'slot' in action && action.slot !== undefined
              ? action.slot
              : places.findIndex((_, i) => !occupied.has(i));
          if (!Number.isInteger(slot) || slot < 0 || slot >= places.length || occupied.has(slot))
            throw new Error(`Seat ${action.seat} is occupied by two actors or has no free slot`);
          p.at = { ...places[slot]! };
          p.seatSlot = slot;
          p.facing = 'front';
          p.seated = 1;
          p.seat = action.seat;
          p.seatHeight = objectShape.chair.seat * (chair.scale ?? 1);
        }
        if (action.action === 'read') {
          if (from[action.actor]!.holding !== action.book)
            throw new Error(
              'A reader must hold the book: take it first or set cast[actor].holding',
            );
          p.holding = action.book;
          p.facing = 'front';
          if (
            action.pages !== undefined &&
            (!Number.isInteger(action.pages) || action.pages < 1 || action.pages > 50)
          )
            throw new Error('Read pages must be an integer in [1,50]');
        }
        if (action.action === 'openBook' || action.action === 'closeBook') {
          if (p.holding !== action.book)
            throw new Error(`${action.action} needs the held book ${action.book}`);
        }
        if (
          action.action === 'openBook' ||
          action.action === 'closeBook' ||
          action.action === 'read'
        ) {
          object(action.book, ['book']);
          if (usedObjects.has(action.book))
            throw new Error(`Two actions own object ${action.book} in beat ${beat.id}`);
          usedObjects.add(action.book);
          objectFrom = objectStates[action.book] ?? 0;
          objectTo = action.action === 'closeBook' ? 0 : 1;
          objectStates[action.book] = objectTo;
        }
        if (action.action === 'turn') {
          if (!['front', 'left', 'right', 'back'].includes(action.facing))
            throw new Error('Unknown facing');
          p.facing = action.facing;
        }
        if (action.action === 'openDoor' || action.action === 'closeDoor') {
          const door = object(action.door, ['door']);
          if (usedObjects.has(action.door))
            throw new Error(`Two actions own object ${action.door} in beat ${beat.id}`);
          usedObjects.add(action.door);
          doorSide = p.at.z >= door.at.z ? 'inside' : 'outside';
          objectFrom = objectStates[action.door] ?? 0;
          approaches[action.actor] = route(
            staging,
            from[action.actor]!.at,
            point(
              doorApproach(door, options.cast[action.actor]!.scale ?? 0.77, objectFrom, doorSide),
            ),
            (options.cast[action.actor]!.scale ?? 0.77) * 0.46,
            doorSide === 'inside' ? [action.door] : [],
          );
          objectTo = action.action === 'openDoor' ? 1 : 0;
          objectStates[action.door] = objectTo;
          p.at = point(
            doorApproach(door, options.cast[action.actor]!.scale ?? 0.77, objectTo, doorSide),
          );
          p.facing = 'left';
          p.seated = 0;
          p.seat = undefined;
        }
        if (action.action === 'passDoor') {
          const door = object(action.door, ['door']);
          if (action.to !== 'inside' && action.to !== 'outside')
            throw new Error('passDoor needs inside or outside');
          if (action.gait !== undefined && !['walk', 'run'].includes(action.gait))
            throw new Error('passDoor gait must be walk or run');
          if ((startingObjects[action.door] ?? 0) < 0.9)
            throw new Error(`Open door ${action.door} before passing through it`);
          if (usedObjects.has(action.door))
            throw new Error(`Two actions own object ${action.door} in beat ${beat.id}`);
          usedObjects.add(action.door);
          const inside = from[action.actor]!.at.z > door.at.z;
          p.at = point(doorPassage(door, action.to));
          const waypoint =
            inside === (action.to === 'inside') ? p.at : point(doorWaypoint(door, action.to));
          via = [
            ...route(
              staging,
              from[action.actor]!.at,
              waypoint,
              (options.cast[action.actor]!.scale ?? 0.77) * 0.46,
              [action.door],
            ),
            waypoint,
          ];
          p.facing = action.to === 'inside' ? 'back' : 'front';
          p.seated = 0;
          p.seat = undefined;
        }
        if (action.action === 'climb' || action.action === 'descend') {
          const stairs = object(action.stairs, ['stairs']);
          if (
            action.action === 'descend' &&
            Math.abs((p.at.height ?? 0) - (stairEnd(stairs).height ?? 0)) > 0.05
          )
            throw new Error('Descend starts on the stair landing');
          approaches[action.actor] = approach(
            action.actor,
            point(action.action === 'climb' ? stairs.at : stairEnd(stairs)),
          );
          p.at = point(action.action === 'climb' ? stairEnd(stairs) : stairs.at);
          p.facing = action.action === 'climb' ? 'back' : 'front';
          p.seated = 0;
          p.seat = undefined;
        }
        if (action.action === 'stand') {
          p.seated = 0;
          p.seat = undefined;
        }
        if (action.action === 'point' || action.action === 'press') {
          const item =
            typeof action.target === 'string' ? staging.objects[action.target] : undefined;
          if (
            item &&
            (Object.values(before).some((actor) => actor.holding === action.target) ||
              (beat.perform ?? []).some((a) => a.action === 'take' && a.object === action.target))
          )
            throw new Error(
              `Put object ${action.target} on a support before pointing at or pressing it`,
            );
          target = item?.trigger
            ? triggerPoint({ ...item, at: itemPositions[String(action.target)] ?? item.at })
            : point(action.target);
          if (action.action === 'press') {
            const approach = pressApproach(
              staging.projection,
              options.cast[action.actor]!,
              p,
              target,
              options.pack.rig,
            );
            p.at = approach.at;
            reachSide = approach.side;
            p.facing = 'front';
            p.seated = 0;
            p.seat = undefined;
          }
          if (action.action === 'press' && item?.trigger && typeof action.target === 'string') {
            const id = action.target;
            if (usedObjects.has(id))
              throw new Error(`Two actions own object ${id} in beat ${beat.id}`);
            usedObjects.add(id);
            const value = objectStates[id] ?? 0;
            effect = {
              id,
              from: value,
              to: item.trigger.effect === 'on' ? 1 : item.trigger.effect === 'off' ? 0 : 1 - value,
            };
            objectStates[id] = effect.to;
          }
        }
      } else {
        if (ids.some((id) => from[id]!.holding && from[id]!.hands === 2))
          throw new Error('A paired action needs free hands; a participant is holding a book');
        const [a, b] = ids,
          sa = options.cast[a!]!.scale ?? 0.77,
          sb = options.cast[b!]!.scale ?? 0.77;
        const separation = 1.6 * (sa + sb);
        meeting = meetingPoint(
          staging,
          interpolate(from[a!]!.at, from[b!]!.at, 0.5),
          separation / 2,
          Math.max(sa, sb) * 0.46,
        );
        const joinedCenter = meeting;
        const center = action.action === 'walkTogether' ? point(action.to) : joinedCenter;
        const ordered = [...ids].sort((a, b) => from[a]!.at.x - from[b]!.at.x);
        if (action.action === 'walkTogether')
          via = route(staging, joinedCenter, center, separation / 2 + Math.max(sa, sb) * 0.46);
        for (const [i, id] of ordered.entries()) {
          const p = to[id]!;
          p.at = { ...center, x: center.x + ((i ? 1 : -1) * separation) / 2 };
          approaches[id] = approach(
            id,
            action.action === 'walkTogether'
              ? { ...joinedCenter, x: joinedCenter.x + ((i ? 1 : -1) * separation) / 2 }
              : p.at,
          );
          p.seated = 0;
          p.seat = undefined;
          p.facing = action.action === 'walkTogether' ? facing(from[id]!.at, p.at) : 'front';
        }
      }
      if (
        'actor' in action &&
        !via &&
        ['walk', 'run', 'flee', 'sit', 'read', 'take', 'put', 'press'].includes(action.action)
      ) {
        const omit = 'seat' in action && action.seat ? [action.seat] : [];
        via = route(
          staging,
          from[action.actor]!.at,
          to[action.actor]!.at,
          (options.cast[action.actor]!.scale ?? 0.77) * 0.46,
          omit,
        );
      }
      for (const id of ids) {
        const owned = used.get(id) ?? new Set<ActionChannel>();
        for (const channel of channels) {
          if (owned.has(channel))
            throw new Error(`Two actions own ${id}.${channel} in beat ${beat.id}`);
          owned.add(channel);
        }
        used.set(id, owned);
      }
      const plan: Plan = {
        start,
        end: cue?.end ?? start + (beat.seconds ?? 1),
        action,
        from,
        to,
        objectFrom,
        objectTo,
        transfer,
        via,
        approaches,
        meeting,
        doorSide,
        effect,
        target,
        reachSide,
        channels,
        timing: { rise: 0, approach: 0, engage: 0, act: 1, release: 0 },
      };
      plan.timing = actionTiming(plan, staging, scales, options.pack.actions);
      plans.push(plan);
      Object.assign(state, to);
    }
    const beatPlans = plans.slice(firstPlan);
    const resolveTiming = () => {
      for (const plan of beatPlans) {
        plan.timing = actionTiming(plan, staging, scales, options.pack.actions);
        plan.end = start + durationOf(plan.timing);
      }
      const natural = Math.max(
        beatPlans.length || cue ? 0 : 2.5,
        ...beatPlans.map((p) => durationOf(p.timing)),
        ...Object.values(beat.props ?? {}).map(
          (p) => propStart(p, beatPlans, start, beat.id) - start + (p.delay ?? 0) + (p.over ?? 0),
        ),
      );
      const end = cue?.end ?? start + (beat.seconds ?? natural);
      if (cue && beat.seconds === undefined && end - start < natural - 1e-6)
        throw new Error(
          `Cue ${beat.id} gives ${(end - start).toFixed(2)}s; actions need ${natural.toFixed(2)}s. Add a narration pause or set beat.seconds to explicitly fit the action.`,
        );
      for (const plan of beatPlans)
        if (beat.seconds !== undefined) plan.end = end;
        else if (overlayAction(plan.action)) {
          plan.timing.act += Math.max(0, end - start - durationOf(plan.timing));
          plan.end = end;
        } else plan.end = start + durationOf(plan.timing);
      return end;
    };
    resolveTiming();
    coordinateTraffic(staging, beatPlans, before, scales, (plan, progress) => {
      const end = resolveTiming();
      return blockAt(
        {
          staging,
          initial: before,
          initialItems,
          initialObjects: startingObjects,
          plans: [plan],
          cues,
          point,
          scales,
        },
        start + progress * (end - start),
      ).actors;
    });
    cursor = resolveTiming();
    cues[beat.id] = { start, end: cursor };
    const seats = new Set<string>();
    for (const p of Object.values(state))
      if (p.seat) {
        if (seats.has(`${p.seat}:${p.seatSlot ?? 0}`))
          throw new Error(`Seat ${p.seat} is occupied by two actors`);
        seats.add(`${p.seat}:${p.seatSlot ?? 0}`);
      }
  }
  return {
    staging,
    initialItems,
    initialObjects,
    initial,
    plans,
    cues,
    point,
    scales,
  };
}
export type Blocking = NonNullable<ReturnType<typeof compileBlocking>>;
