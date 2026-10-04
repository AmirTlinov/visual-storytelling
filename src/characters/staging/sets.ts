import type { StageSet } from '../types.js';
import type { Furniture, GroundPoint, Projection } from './types.js';
import { floorGrid, ground, project } from './space.js';

export interface RoomOptions {
  theme?: 'library' | 'laboratory' | 'classroom';
  seat?: 'chair' | 'bench';
  furnitureScale?: number;
  depth?: number;
}
const projection = (): Projection => ({
  horizon: 270,
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
  const space = projection();
  const wall = { library: '#73817a', laboratory: '#3f626b', classroom: '#8a9b87' }[theme];
  const wood = { library: '#b09061', laboratory: '#9e8667', classroom: '#ba9c70' }[theme];
  const shelf = (x: number) =>
    `<g transform="translate(${x} 75)" stroke="#344747" stroke-width="4" stroke-linejoin="round"><path fill="${wood}" d="M0 0h195v290H0z"/><path fill="#394e4f" d="M13 14h169v261H13z"/>${[0, 1, 2].map((row) => `<g transform="translate(20 ${26 + row * 86})">${[0, 1, 2, 3, 4, 5].map((i) => `<path fill="${['#b97958', '#768d90', '#cfb47b', '#8c9c72', '#a7aca0', '#8d787c'][i]}" d="M${i * 26} ${(i % 2) * 9}h19v64h-19z"/><path stroke="#e4d2a4" stroke-width="2" d="M${i * 26 + 4} 23h11m-11 7h11"/>`).join('')}<path fill="${wood}" d="M-8 67h172v9H-8z"/></g>`).join('')}</g>`;
  const wallArt =
    theme === 'library'
      ? shelf(44) + shelf(720)
      : `<g stroke="#344b4c" stroke-width="5"><path fill="#b4a27a" d="M50 80h190v240H50z"/><path fill="#314f4e" d="M64 94h162v212H64z"/></g><g stroke="#d9d7b7" stroke-width="3" fill="none"><path d="M83 227h119M101 221V158m42 63V128m42 93V177"/><circle cx="153" cy="135" r="35"/></g><g transform="translate(742 115)" stroke="#bfbb98" fill="none" stroke-width="4"><circle cx="60" cy="60" r="51"/><path d="M60 17v48l29 21"/></g>`;
  const svg = `<defs><linearGradient id="$id-room" x2="0" y2="1"><stop stop-color="${wall}"/><stop offset="1" stop-color="#455f5c"/></linearGradient></defs><path fill="url(#$id-room)" d="M0 0h960v650H0z"/><path d="M0 426h960v224H0z" fill="#b8a581"/><path d="M0 425h960" stroke="#d1c5a0" stroke-width="9"/>${floorGrid(space, '#6e7565')}${wallArt}<path fill="#aec3b7" stroke="#34504f" stroke-width="6" d="M323 46h310v265H323z"/><path d="M326 267q61-109 125-51 76-110 178-19v110H326z" fill="#73958a"/><circle cx="562" cy="109" r="28" fill="#f1ddb0"/><path d="M479 49v260M326 181h305" stroke="#34504f" stroke-width="7"/><path d="M311 310h333v12H311z" fill="${wood}" stroke="#34504f" stroke-width="4"/>`;
  return prepareSet(
    svg,
    space,
    {
      entry: ground(-3.5, depth),
      reader: ground(0.2, depth),
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
}
export interface StreetOptions {
  theme?: 'town' | 'park';
  depth?: number;
}
export function street(options: StreetOptions = {}): StageSet {
  const { theme = 'town', depth = 1 } = options,
    space = projection();
  const house = (x: number, w: number, h: number, c: string) =>
    `<g stroke="#3c5757" stroke-width="4"><path fill="${c}" d="M${x} 360V${360 - h}h${w}v${h}Z"/><path fill="#6b7670" d="M${x - 7} ${361 - h}l${w / 2 + 7}-${w * 0.22} ${w / 2 + 7} ${w * 0.22}Z"/>${[0, 1].map((row) => [0, 1, 2].map((i) => `<path fill="#adc8c2" d="M${x + 18 + (i * (w - 36)) / 3} ${385 - h + row * 78}h${(w - 48) / 3 - 10}v48h-${(w - 48) / 3 - 10}z"/>`).join('')).join('')}<path fill="#536e6a" d="M${x + w / 2 - 18} 295h36v65h-36z"/></g>`;
  const background =
    theme === 'town'
      ? house(-30, 205, 240, '#c2ac84') +
        house(186, 242, 300, '#a8b4a1') +
        house(435, 205, 255, '#c49b83') +
        house(650, 328, 310, '#b1b49b')
      : `<path d="M0 307q140-96 292-14 180-127 369-11 190-94 299-22v158H0Z" fill="#8ea884"/><path d="M0 372q240-67 486 1 263-60 474-19v60H0Z" fill="#739582"/>`;
  const svg = `<path fill="#c5d8d0" d="M0 0h960v650H0z"/><circle cx="815" cy="72" r="38" fill="#f2deac"/><g fill="#e6e6cf" opacity=".9"><path d="M80 79q20-32 49-12 28-29 51 8 25-4 36 19H62q0-19 18-15Z"/><path d="M546 47q18-32 44-11 18-30 47 10l34 23H523Z"/></g>${background}<path d="M0 381h960v269H0Z" fill="#b6ae92"/>${floorGrid(space, '#7d8b7b')}<path d="M0 640h960" stroke="#526d68" stroke-width="11"/>`;
  return prepareSet(
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
}

/** A small exploration set: a working door and a staircase share the ground projection. */
export function courtyard(): StageSet {
  const set = street({ theme: 'town' }),
    old = set.staging!;
  return prepareSet(
    set.svg,
    old.projection,
    {
      entry: ground(-2.8, 0.5),
      door: ground(2.2, 3),
      stairs: ground(-2, 1),
      exit: ground(3.5, 0.5),
    },
    {
      door: { kind: 'door', at: ground(2.5, 4), color: '#a78258' },
      stairs: { kind: 'stairs', at: ground(-2, 1) },
      light: { kind: 'lamp', at: ground(4.1, 5), scale: 0.8 },
    },
  );
}
