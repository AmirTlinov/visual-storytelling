import { boardPlane } from './drawing-plane.js';
import { doorPassage } from './doorway.js';
import type { StageSet } from '../types.js';
import type { Destination, Furniture, GroundPoint, RelativePlace, Staging } from './types.js';
import { footprint, supportPoint, stairEnd } from './objects.js';
import { project } from './space.js';

/** Resolve a place using the current arrangement. Rendering and action planning use metres. */
export function destination(staging: Staging, place: Destination): GroundPoint {
  let at: GroundPoint | undefined;
  if (typeof place === 'string') {
    at = Object.hasOwn(staging.spots, place)
      ? staging.spots[place]
      : Object.hasOwn(staging.objects, place)
        ? staging.objects[place]!.at
        : undefined;
    if (!at && place.endsWith('.content')) {
      const item = staging.objects[place.slice(0, -8)];
      const corners = item?.surface?.corners ?? (item?.kind === 'board' ? boardPlane : undefined);
      if (item && corners) {
        const s = item.scale ?? 1;
        at = {
          x: item.at.x + (corners.reduce((n, p) => n + p.x, 0) / 4) * s,
          z: item.at.z + (corners.reduce((n, p) => n + p.z, 0) / 4) * s,
          height:
            (item.at.height ?? 0) + (corners.reduce((n, p) => n + (p.height ?? 0), 0) / 4) * s,
        };
      }
    }
  } else if (place && typeof place === 'object' && 'of' in place) {
    const item = Object.hasOwn(staging.objects, place.of) ? staging.objects[place.of] : undefined;
    const origin =
      item?.at ?? (Object.hasOwn(staging.spots, place.of) ? staging.spots[place.of] : undefined);
    if (!origin) throw new Error(`Unknown placement reference: ${place.of}`);
    const gap = place.gap ?? 0.75;
    if (!Number.isFinite(gap) || gap < 0) throw new Error('Placement gap must be non-negative');
    const box = item && footprint(item);
    at = { ...origin };
    if (place.side === 'on') {
      if (!item) throw new Error('On placement needs a physical support');
      at = supportPoint(item);
    } else if (place.side === 'inside' || place.side === 'outside') {
      if (!item || item.kind !== 'door') throw new Error('Inside/outside placement needs a door');
      at = doorPassage(item, place.side);
    } else if (place.side === 'landing') {
      if (!item || item.kind !== 'stairs') throw new Error('Landing placement needs stairs');
      at = stairEnd(item);
    } else if (place.side === 'left') at.x = (box?.left ?? origin.x) - gap;
    else if (place.side === 'right') at.x = (box?.right ?? origin.x) + gap;
    else if (place.side === 'front') at.z = (box?.front ?? origin.z) - gap;
    else if (place.side === 'back') at.z = (box?.back ?? origin.z) + gap;
    else throw new Error(`Unknown placement side: ${String(place.side)}`);
    if (place.offset) {
      at.x += place.offset.x;
      at.z += place.offset.z;
      at.height = (at.height ?? 0) + (place.offset.height ?? 0);
    }
  } else at = place;
  if (!at || ![at.x, at.z, at.height ?? 0].every(Number.isFinite))
    throw new Error(
      `Unknown or invalid stage destination: ${typeof place === 'string' ? place : JSON.stringify(place)}`,
    );
  project(staging.projection, at);
  return { ...at };
}

export interface SetLayout {
  objects?: Readonly<
    Record<string, (Partial<Omit<Furniture, 'at'>> & { at?: Destination }) | null>
  >;
  spots?: Readonly<Record<string, Destination | null>>;
}
/** Reuse a set, placing props and named marks relative to each other; cycles are authoring errors. */
export function arrange(base: StageSet, layout: SetLayout): StageSet {
  if (!base.staging) throw new Error('Arrange needs a prepared set');
  const staging: Staging = {
    ...base.staging,
    objects: Object.create(null),
    spots: Object.create(null),
  };
  const objects: Record<string, (Omit<Furniture, 'at'> & { at: Destination }) | null> =
    Object.assign(Object.create(null), base.staging.layout?.objects ?? base.staging.objects);
  for (const [id, change] of Object.entries(layout.objects ?? {})) {
    if (change === null) {
      objects[id] = null;
      continue;
    }
    const item = { ...objects[id], ...change };
    if (!item.kind || !item.at) throw new Error(`New stage object ${id} needs kind and at`);
    objects[id] = item as Omit<Furniture, 'at'> & { at: Destination };
  }
  const spots = { ...(base.staging.layout?.spots ?? base.staging.spots), ...layout.spots };
  staging.layout = {
    objects: Object.fromEntries(
      Object.entries(objects).filter(
        (entry): entry is [string, Omit<Furniture, 'at'> & { at: Destination }] =>
          entry[1] !== null,
      ),
    ),
    spots: Object.fromEntries(
      Object.entries(spots).filter((entry): entry is [string, Destination] => entry[1] !== null),
    ),
  };
  const visiting = new Set<string>(),
    done = new Set<string>();
  const solve = (kind: 'objects' | 'spots', id: string) => {
    const key = `${kind}:${id}`;
    if (done.has(key)) return;
    if (visiting.has(key)) throw new Error(`Circular stage placement: ${id}`);
    const entry = (kind === 'objects' ? objects : spots)[id];
    if (!entry) return;
    visiting.add(key);
    const place = kind === 'objects' ? (entry as Furniture).at : (entry as Destination);
    const ref =
      typeof place === 'string'
        ? place
        : place && typeof place === 'object' && 'of' in place
          ? (place as RelativePlace).of
          : undefined;
    if (ref) {
      // Names denote spots first; a spatial relation denotes physical furniture first.
      // Use the same precedence as destination, including while dependencies are unresolved.
      const reference =
        typeof place === 'string' && ref.endsWith('.content') ? ref.slice(0, -8) : ref;
      const owners =
        typeof place === 'string'
          ? (['spots', 'objects'] as const)
          : (['objects', 'spots'] as const);
      for (const owner of owners) {
        const entries = owner === 'objects' ? objects : spots;
        if (Object.hasOwn(entries, reference) && entries[reference]) {
          solve(owner, reference);
          break;
        }
      }
    }
    const at = destination(staging, place);
    if (kind === 'objects')
      (staging.objects as Record<string, Furniture>)[id] = { ...(entry as Furniture), at };
    else (staging.spots as Record<string, GroundPoint>)[id] = at;
    visiting.delete(key);
    done.add(key);
  };
  for (const id of Object.keys(objects)) solve('objects', id);
  for (const id of Object.keys(spots)) solve('spots', id);
  return {
    ...base,
    staging,
    spots: Object.fromEntries(
      Object.entries(staging.spots).map(([id, at]) => [id, project(staging.projection, at)]),
    ),
  };
}
