import { arrange } from '../characters/staging/layout.js';
import { readingRoom } from '../characters/staging/sets.js';
import { furnitureParts } from '../characters/staging/furniture.js';
import { supportPoint, footprint } from '../characters/staging/objects.js';
import type { StageSet } from '../characters/types.js';
import type { Furniture } from '../characters/staging/types.js';
import type { NotebookSource } from './opening.js';
import { snapshotSVG } from '../export/index.js';
import type { characterStage } from '../characters/stage.js';

/** Freeze the actual stage boundary before decoding its background image. */
export async function notebookSource(
  stage: Awaited<ReturnType<typeof characterStage>>,
  bookId: string,
): Promise<NotebookSource> {
  const set = stage.set,
    book = stage.restingBook(bookId);
  if (!book) throw new Error(`Put ${bookId} on a support before entering its page`);
  const support = notebookSupport(set, book);
  if (!support) throw new Error(`Place ${bookId} on furniture before entering its page`);
  const camera = (stage.snapshot() as { camera: NotebookSource['camera'] }).camera;
  const image = stage.capture({
    camera: { x: 0, y: 0, width: set.width, height: set.height },
    omit: [
      bookId,
      ...(furnitureParts(support[1], set.staging!.projection).length ? [support[0]] : []),
    ],
  });
  return {
    image: await image,
    width: set.width,
    height: set.height,
    camera,
    projection: set.staging!.projection,
    book,
    support: support[1],
  };
}

/** A semantic book/support pair is prepared once; story authors do not tune camera coordinates. */
export function notebookWorld(set: StageSet) {
  if (!set.staging) throw new Error('Storybook character chapters need a prepared world');
  let bookId = Object.keys(set.staging.objects).find(
    (id) => set.staging!.objects[id]!.kind === 'book',
  );
  if (!bookId) {
    const available = (name: string) => {
      let id = name;
      for (let n = 2; Object.hasOwn(set.staging!.objects, id); n++) id = `${name}-${n}`;
      return id;
    };
    bookId = available('story-notebook');
    const deskId = available('story-desk');
    const z = -0.4,
      space = set.staging.projection,
      scale = space.distance / (space.distance + z);
    const x = (set.width * 0.81 - space.center) / (space.unit * scale);
    set = arrange(set, {
      objects: {
        [deskId]: { kind: 'table', at: { x, z }, scale: 1, color: '#9e8667' },
        [bookId]: {
          kind: 'book',
          at: { of: deskId, side: 'on' },
          scale: 0.72,
          color: '#385c63',
        },
      },
    });
  } else set = arrange(set, { objects: { [bookId]: { color: '#385c63' } } });
  return { set, bookId };
}
/** Resolve the actual support after the score has moved or put the notebook down. */
export function notebookSupport(set: StageSet, book: Furniture) {
  return Object.entries(set.staging!.objects)
    .filter(([, item]) => {
      if (!item.support && !['table', 'chair', 'bench'].includes(item.kind)) return false;
      const point = supportPoint(item),
        bounds = footprint(item);
      return (
        Math.abs((point.height ?? 0) - (book.at.height ?? 0)) < 0.06 &&
        (bounds
          ? book.at.x >= bounds.left &&
            book.at.x <= bounds.right &&
            book.at.z >= bounds.front &&
            book.at.z <= bounds.back
          : Math.hypot(point.x - book.at.x, point.z - book.at.z) < 0.001)
      );
    })
    .sort(
      ([, a], [, b]) =>
        Math.hypot(a.at.x - book.at.x, a.at.z - book.at.z) -
        Math.hypot(b.at.x - book.at.x, b.at.z - book.at.z),
    )[0];
}

let studyInstance = 0;
/** Paper-only stories establish a quiet historical study before entering the same notebook. */
export async function studySource(parent: HTMLElement): Promise<NotebookSource> {
  const { set, bookId } = notebookWorld(readingRoom({ theme: 'library' }));
  const book = set.staging!.objects[bookId]!,
    support = notebookSupport(set, book);
  if (!support) throw new Error('The study notebook needs its furniture support');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${set.width} ${set.height}`);
  const parts = Object.entries(set.staging!.objects)
    .flatMap(([id, item]) =>
      id === bookId || id === support[0] ? [] : furnitureParts(item, set.staging!.projection),
    )
    .sort((a, b) => b.depth - a.depth);
  svg.innerHTML =
    set.svg.replaceAll('$id', `book-study-${++studyInstance}`) + parts.map((p) => p.svg).join('');
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${set.width}px;height:${set.height}px;pointer-events:none`;
  svg.setAttribute('width', String(set.width));
  svg.setAttribute('height', String(set.height));
  host.append(svg);
  parent.append(host);
  let image: HTMLCanvasElement;
  try {
    image = await snapshotSVG(svg);
  } finally {
    host.remove();
  }
  return {
    image,
    width: set.width,
    height: set.height,
    camera: { x: 0, y: 0, width: set.width, height: set.height },
    projection: set.staging!.projection,
    book,
    support: support[1],
  };
}
