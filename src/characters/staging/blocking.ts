import { stagingCatalog } from './catalog.js';
import type { CharacterStageOptions } from '../types.js';
import type { Script } from '../../story/cues.js';
import type { Destination, Facing, GroundPoint, StageAction } from './types.js';
import { stairEnd, objectShape, supportPoint } from './objects.js';
import { doorApproach, doorPassage, doorWaypoint } from './doorway.js';
import { distance, interpolate, project, facing } from './space.js';

export interface Placement {
  at: GroundPoint;
  facing: Facing;
  seated: number;
  seatHeight: number;
  seat?: string;
  book?: string;
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
  bookBlend?: number;
  turn?: number;
  handTurn?: number;
  reach?: { at: GroundPoint; weight: number; press: number };
}
export interface PairContact {
  actors: readonly [string, string];
  weight: number;
  high: boolean;
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
}
function participants(a: StageAction) {
  if (!a || typeof a !== 'object') throw new Error('A prepared action is required');
  if (['highFive', 'walkTogether'].includes(a.action)) {
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

export function compileBlocking(options: CharacterStageOptions, script: Script) {
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
  const point = (to: Destination): GroundPoint => {
    const p =
      typeof to === 'string'
        ? Object.hasOwn(staging.spots, to)
          ? staging.spots[to]
          : Object.hasOwn(staging.objects, to)
            ? staging.objects[to]?.at
            : undefined
        : to;
    if (
      !p ||
      ![p.x, p.z, p.height ?? 0].every(Number.isFinite) ||
      p.z <= -staging.projection.distance
    )
      throw new Error(`Unknown or invalid stage destination: ${String(to)}`);
    return { ...p };
  };
  for (const spot of Object.values(staging.spots)) point(spot);
  for (const [id, item] of Object.entries(staging.objects)) {
    if (!stagingCatalog.objects.includes(item.kind))
      throw new Error(`Unknown stage object kind: ${id}`);
    point(item.at);
    if (item.scale !== undefined && (!Number.isFinite(item.scale) || item.scale <= 0))
      throw new Error(`Invalid object scale: ${id}`);
  }
  const initial: Record<string, Placement> = Object.create(null),
    held = new Set<string>();
  for (const [id, a] of Object.entries(options.cast)) {
    if (typeof a.at !== 'string')
      throw new Error(`Actor ${id}: prepared sets use a named ground spot`);
    initial[id] = { at: point(a.at), facing: 'front', seated: 0, seatHeight: 0, book: a.holding };
    if (a.holding !== undefined) {
      if (!Object.hasOwn(staging.objects, a.holding) || staging.objects[a.holding]?.kind !== 'book')
        throw new Error(`Unknown held book: ${a.holding}`);
      if (held.has(a.holding)) throw new Error(`Book ${a.holding} already has a holder`);
      held.add(a.holding);
    }
  }
  const state = structuredClone(initial),
    plans: Plan[] = [],
    objectStates: Record<string, number> = Object.create(null);
  const initialBooks = Object.fromEntries(
    Object.entries(staging.objects)
      .filter(([, v]) => v.kind === 'book')
      .map(([id, v]) => [id, { ...v.at }]),
  );
  const bookPositions = structuredClone(initialBooks);
  const object = (id: string, kind: string[]) => {
    const item = Object.hasOwn(staging.objects, id) ? staging.objects[id] : undefined;
    if (!item || !kind.includes(item.kind))
      throw new Error(`Object ${id} must be ${kind.join(' or ')}`);
    return item;
  };
  for (const beat of options.beats) {
    const startingObjects = { ...objectStates };
    const used = new Set<string>(),
      usedObjects = new Set<string>();
    for (const action of beat.perform ?? []) {
      const ids = participants(action);
      if (new Set(ids).size !== ids.length)
        throw new Error('An interaction needs distinct participants');
      for (const id of ids) {
        if (!Object.hasOwn(state, id)) throw new Error(`Unknown action participant: ${id}`);
        if (used.has(id)) throw new Error(`Two actions own ${id} in beat ${beat.id}`);
        used.add(id);
      }
      const from = Object.fromEntries(ids.map((id) => [id, structuredClone(state[id]!)]));
      const to = structuredClone(from);
      let objectFrom: number | undefined,
        objectTo: number | undefined,
        transfer: Plan['transfer'],
        via: Plan['via'];
      if ('actor' in action) {
        const p = to[action.actor]!;
        if (p.book && ['point', 'press', 'openDoor'].includes(action.action))
          throw new Error(
            `${action.action} needs a free hand; actor ${action.actor} is holding a book`,
          );
        if (action.action === 'take' || action.action === 'put') {
          let id: string, at: GroundPoint;
          if (action.action === 'take') {
            object(action.object, ['book']);
            id = action.object;
            at = bookPositions[id]!;
            if (p.book) throw new Error(`Actor ${action.actor} already holds a book`);
            if (Object.values(state).some((actor) => actor.book === id))
              throw new Error(`Book ${id} already has a holder`);
            p.book = id;
          } else {
            if (!p.book) throw new Error(`Actor ${action.actor} has no book to put`);
            id = p.book;
            at = supportPoint(object(action.onto, ['table']));
            bookPositions[id] = { ...at };
            p.book = undefined;
          }
          if (usedObjects.has(id))
            throw new Error(`Two actions own object ${id} in beat ${beat.id}`);
          usedObjects.add(id);
          transfer = { id, at: { ...at }, taking: action.action === 'take' };
          p.at = point({
            x: at.x - 0.62 * (options.cast[action.actor]!.scale ?? 0.77),
            z: at.z - 0.6,
            height: from[action.actor]!.at.height ?? 0,
          });
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
          p.at = { ...chair.at };
          p.facing = 'front';
          p.seated = 1;
          p.seat = action.seat;
          p.seatHeight = objectShape.chair.seat * (chair.scale ?? 1);
        }
        if (action.action === 'read') {
          object(action.book, ['book']);
          if (from[action.actor]!.book !== action.book)
            throw new Error(
              'A reader must hold the book: take it first or set cast[actor].holding',
            );
          p.book = action.book;
          p.facing = 'front';
          if (
            action.pages !== undefined &&
            (!Number.isInteger(action.pages) || action.pages < 1 || action.pages > 50)
          )
            throw new Error('Read pages must be an integer in [1,50]');
        }
        if (action.action === 'openDoor') {
          const door = object(action.door, ['door']);
          if (usedObjects.has(action.door))
            throw new Error(`Two actions own object ${action.door} in beat ${beat.id}`);
          usedObjects.add(action.door);
          objectFrom = objectStates[action.door] ?? 0;
          point(doorApproach(door, options.cast[action.actor]!.scale ?? 0.77, objectFrom));
          objectTo = 1;
          objectStates[action.door] = 1;
          p.at = point(doorApproach(door, options.cast[action.actor]!.scale ?? 0.77, 1));
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
          if (inside === (action.to === 'inside'))
            throw new Error(`Actor ${action.actor} is already ${action.to} door ${action.door}`);
          p.at = point(doorPassage(door, action.to));
          via = [point(doorWaypoint(door, action.to))];
          p.facing = action.to === 'inside' ? 'back' : 'front';
          p.seated = 0;
          p.seat = undefined;
        }
        if (action.action === 'climb') {
          const stairs = object(action.stairs, ['stairs']);
          p.at = point(stairEnd(stairs));
          p.facing = 'back';
          p.seated = 0;
          p.seat = undefined;
        }
        if (action.action === 'stand') {
          p.seated = 0;
          p.seat = undefined;
        }
        if (action.action === 'point' || action.action === 'press') point(action.target);
      } else {
        if (ids.some((id) => from[id]!.book))
          throw new Error('A paired action needs free hands; a participant is holding a book');
        const [a, b] = ids,
          sa = options.cast[a!]!.scale ?? 0.77,
          sb = options.cast[b!]!.scale ?? 0.77;
        const center =
          action.action === 'walkTogether'
            ? point(action.to)
            : interpolate(from[a!]!.at, from[b!]!.at, 0.5);
        const separation = 1.6 * (sa + sb);
        for (const [i, id] of ids.entries()) {
          const p = to[id]!;
          p.at = { ...center, x: center.x + ((i ? 1 : -1) * separation) / 2 };
          p.seated = 0;
          p.seat = undefined;
          p.facing = action.action === 'walkTogether' ? facing(from[id]!.at, p.at) : 'front';
        }
      }
      const cue = script.cues[beat.id]!;
      plans.push({
        start: cue.start,
        end: cue.end,
        action,
        from,
        to,
        objectFrom,
        objectTo,
        transfer,
        via,
      });
      Object.assign(state, to);
    }
    const seats = new Set<string>();
    for (const p of Object.values(state))
      if (p.seat) {
        if (seats.has(p.seat)) throw new Error(`Seat ${p.seat} is occupied by two actors`);
        seats.add(p.seat);
      }
  }
  return {
    staging,
    initialBooks,
    initial,
    plans,
    point,
    scales: Object.fromEntries(
      Object.entries(options.cast).map(([id, a]) => [id, a.scale ?? 0.77]),
    ),
  };
}
export type Blocking = NonNullable<ReturnType<typeof compileBlocking>>;
