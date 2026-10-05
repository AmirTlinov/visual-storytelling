import type { StageSet } from '../types.js';
import type { Furniture, GroundPoint, Projection } from './types.js';
import { floorGrid, ground, project } from './space.js';
import { projectedParts } from './geometry.js';
import { doorPassage } from './doorway.js';
import { objectShape } from './objects.js';
import { arrange } from './layout.js';

export type StagePerspective = 'stage' | 'overview';
export interface RoomOptions {
  /** Drawing width, at least 960. World placement and the 650-unit height stay unchanged. */
  width?: number;
  perspective?: StagePerspective;
  theme?: 'library' | 'laboratory' | 'classroom';
  seat?: 'chair' | 'bench';
  furnitureScale?: number;
  depth?: number;
}
const projection = (view: StagePerspective = 'stage'): Projection => ({
  horizon: view === 'overview' ? 170 : 270,
  floor: 610,
  center: 480,
  unit: 100,
  distance: 12,
});
export function prepareSet(
  svg: string,
  space: Projection,
  spots: Record<string, GroundPoint>,
  objects: Record<string, Furniture>,
): StageSet {
  return {
    width: 960,
    height: 650,
    svg,
    spots: Object.fromEntries(Object.entries(spots).map(([id, p]) => [id, project(space, p)])),
    staging: { projection: space, spots, objects },
  };
}
export function readingRoom(options: RoomOptions = {}): StageSet {
  const { theme = 'library', seat = 'chair', furnitureScale = 1, depth = 1 } = options;
  const space = projection(options.perspective);
  const width = options.width ?? 960;
  if (!Number.isFinite(width) || width < 960)
    throw new Error('Room width must be at least 960 drawing units');
  space.center = width / 2;
  const backY = project(space, ground(0, 14.3)).y;
  const wall = { library: '#73817a', laboratory: '#3f626b', classroom: '#8a9b87' }[theme];
  const wood = { library: '#b09061', laboratory: '#9e8667', classroom: '#ba9c70' }[theme];
  const shelf = (x: number) =>
    `<g transform="translate(${x} 75)" stroke="#344747" stroke-width="4" stroke-linejoin="round"><path fill="${wood}" d="M0 0h195v290H0z"/><path fill="#394e4f" d="M13 14h169v261H13z"/>${[0, 1, 2].map((row) => `<g transform="translate(20 ${26 + row * 86})">${[0, 1, 2, 3, 4, 5].map((i) => `<path fill="${['#b97958', '#768d90', '#cfb47b', '#8c9c72', '#a7aca0', '#8d787c'][i]}" d="M${i * 26} ${(i % 2) * 9}h19v64h-19z"/><path stroke="#e4d2a4" stroke-width="2" d="M${i * 26 + 4} 23h11m-11 7h11"/>`).join('')}<path fill="${wood}" d="M-8 67h172v9H-8z"/></g>`).join('')}</g>`;
  const wallArt =
    theme === 'library'
      ? shelf(44) + shelf(width - 240)
      : `<g stroke="#344b4c" stroke-width="5"><path fill="#b4a27a" d="M50 80h190v240H50z"/><path fill="#314f4e" d="M64 94h162v212H64z"/></g><g stroke="#d9d7b7" stroke-width="3" fill="none"><path d="M83 227h119M101 221V158m42 63V128m42 93V177"/><circle cx="153" cy="135" r="35"/></g><g transform="translate(${width - 218} 115)" stroke="#bfbb98" fill="none" stroke-width="4"><circle cx="60" cy="60" r="51"/><path d="M60 17v48l29 21"/></g>`;
  const svg = `<defs><linearGradient id="$id-room" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="650"><stop stop-color="${wall}"/><stop offset="1" stop-color="#455f5c"/></linearGradient></defs><path fill="url(#$id-room)" d="M0 0h${width}v650H0z"/><path d="M0 ${backY}h${width}v${650 - backY}H0z" fill="#b8a581"/><path d="M0 ${backY}h${width}" stroke="#d1c5a0" stroke-width="9"/>${floorGrid(space, '#6e7565', 14.3)}<g transform="translate(0 ${backY - 425})">${wallArt}<g transform="translate(${(width - 960) / 2} 0)"><path fill="#aec3b7" stroke="#34504f" stroke-width="6" d="M323 46h310v265H323z"/><path d="M326 267q61-109 125-51 76-110 178-19v110H326z" fill="#73958a"/><circle cx="562" cy="109" r="28" fill="#f1ddb0"/><path d="M479 49v260M326 181h305" stroke="#34504f" stroke-width="7"/><path d="M311 310h333v12H311z" fill="${wood}" stroke="#34504f" stroke-width="4"/></g></g>`;
  const set = prepareSet(
    svg,
    space,
    {
      entry: ground(-3.5, depth),
      reader: ground(0.2, depth - objectShape.chair.halfDepth * furnitureScale - 0.75),
      exit: ground(3.5, depth),
      partner: ground(2.7, depth),
    },
    {
      seat: { kind: seat, at: ground(0.2, depth), scale: furnitureScale, color: wood },
      book: {
        kind: 'book',
        at: ground(2.8, depth + 0.9, 1.86 * 0.8 + 0.04),
        color: theme === 'laboratory' ? '#b08b57' : '#8d4c4d',
      },
      sideTable: { kind: 'table', at: ground(2.8, depth + 0.9), scale: 0.8, color: wood },
      plant: { kind: 'tree', at: ground(-3.8, depth + 3), scale: 0.65 },
    },
  );
  set.width = width;
  set.backdrop = { divide: backY, above: 'url(#$id-room)', below: '#b8a581' };
  return arrange(set, {
    objects: { book: { at: { of: 'sideTable', side: 'on' } } },
    spots: { reader: { of: 'seat', side: 'front', gap: 0.75 } },
  });
}
export interface StreetOptions {
  perspective?: StagePerspective;
  theme?: 'town' | 'park';
  depth?: number;
}
export function street(options: StreetOptions = {}): StageSet {
  const { theme = 'town', depth = 1 } = options,
    space = projection(options.perspective);
  const backY = project(space, ground(0, 25)).y;
  const house = (x: number, w: number, h: number, c: string) =>
    `<g stroke="#3c5757" stroke-width="4"><path fill="${c}" d="M${x} 360V${360 - h}h${w}v${h}Z"/><path fill="#6b7670" d="M${x - 7} ${361 - h}l${w / 2 + 7}-${w * 0.22} ${w / 2 + 7} ${w * 0.22}Z"/>${[0, 1].map((row) => [0, 1, 2].map((i) => `<path fill="#adc8c2" d="M${x + 18 + (i * (w - 36)) / 3} ${385 - h + row * 78}h${(w - 48) / 3 - 10}v48h-${(w - 48) / 3 - 10}z"/>`).join('')).join('')}<path fill="#536e6a" d="M${x + w / 2 - 18} 295h36v65h-36z"/></g>`;
  const background =
    theme === 'town'
      ? house(-30, 205, 240, '#c2ac84') +
        house(186, 242, 300, '#a8b4a1') +
        house(435, 205, 255, '#c49b83') +
        house(650, 328, 310, '#b1b49b')
      : `<path d="M0 307q140-96 292-14 180-127 369-11 190-94 299-22v158H0Z" fill="#8ea884"/><path d="M0 372q240-67 486 1 263-60 474-19v60H0Z" fill="#739582"/>`;
  const svg = `<path fill="#c5d8d0" d="M0 0h960v650H0z"/><circle cx="815" cy="72" r="38" fill="#f2deac"/><g fill="#e6e6cf" opacity=".9"><path d="M80 79q20-32 49-12 28-29 51 8 25-4 36 19H62q0-19 18-15Z"/><path d="M546 47q18-32 44-11 18-30 47 10l34 23H523Z"/></g>${`<g transform="translate(0 ${backY - 381})">${background}</g>`}<path d="M0 ${backY}h960v${650 - backY}H0Z" fill="#b6ae92"/>${floorGrid(space, '#7d8b7b')}<path d="M0 640h960" stroke="#526d68" stroke-width="11"/>`;
  const set = prepareSet(
    svg,
    space,
    {
      entry: ground(-3.7, depth),
      left: ground(-1.9, depth),
      right: ground(0.4, depth),
      exit: ground(3.4, depth),
      far: ground(2, 7),
      near: ground(-1.5, 0.3),
    },
    {
      tree: { kind: 'tree', at: ground(-4.3, 2.6), scale: 0.92 },
      light: { kind: 'lamp', at: ground(3.8, 0.2), scale: 1.1 },
      bench: { kind: 'bench', at: ground(0.5, 7), scale: 1.25, color: '#997a55' },
    },
  );
  return { ...set, backdrop: { divide: backY, above: '#c5d8d0', below: '#b6ae92' } };
}

export interface CourtyardOptions {
  perspective?: StagePerspective;
  theme?: 'workshop' | 'library';
  entranceScale?: number;
}
/** One architectural courtyard: pavement, annex and entrance share the same horizon. */
export function courtyard(options: CourtyardOptions = {}): StageSet {
  const space: Projection = {
    horizon: options.perspective === 'overview' ? 145 : 225,
    floor: 620,
    center: 440,
    unit: 98,
    distance: 14,
  };
  const library = options.theme === 'library';
  const door: Furniture = {
    kind: 'door',
    at: ground(1.9, 7),
    scale: options.entranceScale ?? 1,
    color: library ? '#626f90' : '#537d77',
    facade: { wall: library ? '#c3c4b0' : '#cebd97', inside: library ? '#a9b5b6' : '#8faba4' },
  };
  const stairs: Furniture = { kind: 'stairs', at: ground(-3.2, 2.8) };
  const { parts, group } = projectedParts({ kind: 'board', at: ground(0, 0) }, space);
  group(0, (path) => {
    const face = (
      x: number,
      y: number,
      w: number,
      h: number,
      z: number,
      color: string,
      stroke = 2.5,
    ) =>
      path(
        [
          [x, y, z],
          [x + w, y, z],
          [x + w, y + h, z],
          [x, y + h, z],
        ],
        color,
        stroke,
      );
    let svg = face(-12, 0, 24, 2.65, 13, '#9ba99a');
    svg += face(-12, 2.65, 24, 0.14, 13, '#ced0b1');
    for (let x = -12; x < 12; x += 2.4) svg += face(x, 0, 0.16, 2.8, 12.95, '#b7b99c', 1.6);
    // Lower annex and the landing meet at the same wall plane.
    svg += face(-5.2, 0, 3.55, 4.92, 7.28, library ? '#a5b5ad' : '#afbdac');
    svg += face(-5.2, 0, 3.55, 0.5, 7.26, '#8b9b8a');
    svg += face(-4.87, 2.44, 3, 1.8, 7.25, '#4f6e66');
    svg += face(-4.7, 2.57, 2.66, 1.53, 7.23, '#d4d5b3', 1.5);
    for (const x of [-3.85, -2.93]) svg += face(x, 2.56, 0.085, 1.55, 7.22, '#668676', 0);
    svg += face(-4.75, 3.33, 2.75, 0.075, 7.21, '#668676', 0);
    svg += face(-5.37, 4.9, 3.88, 0.14, 7.1, '#d5c7a4');
    svg += path(
      [
        [-5.45, 5.05, 7.08],
        [-1.45, 5.05, 7.08],
        [-1.6, 5.42, 8.6],
        [-5.3, 5.42, 8.6],
      ],
      '#607e74',
    );
    // A path is laid on the ground instead of painted as a second perspective.
    svg += path(
      [
        [-5.6, 0, -0.3],
        [5.8, 0, -0.3],
        [5.8, 0, 7],
        [-5.6, 0, 7],
      ],
      '#b9b49a',
      0,
    );
    for (let z = 0; z < 7; z += 1.25)
      for (let x = -5.6; x < 5.4; x += 1.6) {
        const offset = (Math.round(z / 1.25) % 2) * 0.8;
        svg += path(
          [
            [x + offset, 0.002, z],
            [Math.min(5.8, x + offset + 1.55), 0.002, z],
            [Math.min(5.8, x + offset + 1.55), 0.002, z + 1.2],
            [x + offset, 0.002, z + 1.2],
          ],
          (Math.round((x + 5.6) / 1.6) + Math.round(z / 1.25)) % 4 === 0 ? '#c7bea2' : '#b9b49a',
          0.65,
        );
      }
    return svg;
  });
  const svg = `<path fill="#c8d8ce" d="M0 0h960v650H0z"/><circle cx="130" cy="85" r="39" fill="#f1dfb4"/>
    <g fill="#e4e5cf"><path d="M20 91q31-30 67-3 40-45 71-5l50 25H9Z"/><path d="M715 56q28-32 60-7 38-27 57 10l49 15H684Z"/></g>
    <path fill="#88a48e" d="M0 239Q71 117 142 219Q214 115 279 234Q374 149 463 241Q618 134 693 239Q820 133 960 245V390H0Z"/>
    <path fill="#a9ad92" d="M0 395h960v255H0z"/>${parts.map((p) => p.svg).join('')}`;
  const set = arrange(
    prepareSet(
      svg,
      space,
      {
        entry: ground(-1.25, 0.7),
        door: doorPassage(door, 'outside'),
        inside: doorPassage(door, 'inside'),
        stairs: { ...stairs.at },
        exit: ground(-4.4, 0.7),
      },
      { door, stairs, plant: { kind: 'tree', at: ground(5.4, 8.3), scale: 0.85 } },
    ),
    {
      spots: {
        door: { of: 'door', side: 'outside' },
        inside: { of: 'door', side: 'inside' },
        stairs: { of: 'stairs', side: 'front', gap: 0 },
        landing: { of: 'stairs', side: 'landing' },
      },
    },
  );
  return { ...set, backdrop: { divide: 395, above: '#c8d8ce', below: '#a9ad92' } };
}

/** Ready blocking for explaining a diagram: a presenter, a clear board and optional reading props. */
export function teachingRoom(options: RoomOptions = {}): StageSet {
  return arrange(readingRoom(options), {
    objects: {
      seat: { at: { x: -3.8, z: 4.5 }, scale: 0.8 },
      sideTable: { at: { x: 3.8, z: 4.5 }, scale: 0.65 },
      board: { kind: 'board', at: { x: 1.1, z: 4.4 }, scale: 1.3 },
      plant: null,
    },
    spots: {
      presenter: { of: 'board', side: 'left', gap: 1.6, offset: { x: 0, z: -1.3 } },
      entry: { of: 'board', side: 'left', gap: 2, offset: { x: 0, z: -2 } },
    },
  });
}
