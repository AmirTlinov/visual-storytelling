import type { CharacterCompositor } from '../compositor.js';
import { color } from './furniture.js';
import { projective, type Quad, type XY } from '../../ink/projective.js';
import { notebookPageAspect, type notebookFaces, type NotebookFace } from './notebook.js';
import { stageInk } from './geometry.js';

export interface BookFrame {
  id: string;
  x: number;
  y: number;
  scale: number;
  turn: number;
  handTurn: number;
  color: string;
  open: number;
  /** The existing transfer phase tilts the same vertices onto their physical support. */
  resting?: { faces: ReturnType<typeof notebookFaces>; weight: number };
}
/** The cover, page and fingers share the same fold geometry. */
function fold(book: BookFrame) {
  const open = book.open,
    w = 82 * book.scale,
    h = 42 * book.scale;
  return {
    open,
    w,
    h,
    cx: book.x - ((1 - open) * w) / 2,
    edge: Math.cos(Math.PI * open) * w,
    lift: Math.sin(Math.PI * open) * h * 0.95,
  };
}
function heldPage(book: BookFrame): Quad {
  const { w, h, cx } = fold(book),
    cy = book.y;
  return [
    { x: cx, y: cy - h * 0.65 },
    { x: cx + w, y: cy - h },
    { x: cx + w, y: cy + h * 0.15 },
    { x: cx, y: cy + h * 0.42 },
  ];
}
function heldLeaf(book: BookFrame, turn?: number): Quad {
  const { w, h, cx, edge, lift } = fold(book),
    x = turn === undefined ? edge : -Math.cos(Math.PI * turn) * w,
    raise = turn === undefined ? lift : Math.sin(Math.PI * turn) * h * 1.3;
  return [
    { x: cx, y: book.y - h * 0.65 },
    { x: cx + x, y: book.y - h - raise },
    { x: cx + x, y: book.y + h * 0.15 - raise },
    { x: cx, y: book.y + h * 0.42 },
  ];
}
const between = (a: XY, b: XY, weight: number): XY => ({
  x: a.x + (b.x - a.x) * weight,
  y: a.y + (b.y - a.y) * weight,
});
/** Every permanent face has the same corner identities in the hand and on the table. */
function transferredPoints(book: BookFrame, points: Quad, name?: NotebookFace): Quad {
  const resting = book.resting;
  if (!resting?.weight) return points;
  const target = resting.faces.find((face) => face.name === name);
  let destination: Quad;
  if (target) destination = target.points;
  else {
    // A loose turning leaf follows the base page's chart, never the old held position.
    const page = resting.faces.find((face) => face.name === 'page')!;
    const from = projective(heldPage(book), 1, 1)!,
      to = projective(page.points, 1, 1)!;
    destination = points.map((point) => {
      const uv = from.inverse(point.x, point.y);
      return to.at(uv.x, uv.y);
    }) as unknown as Quad;
  }
  return points.map((point, i) =>
    between(point, destination[i]!, resting.weight),
  ) as unknown as Quad;
}
export function bookHands(book: BookFrame) {
  const page = transferredPoints(book, heldPage(book), 'page'),
    leaf = transferredPoints(
      book,
      heldLeaf(book, book.handTurn || undefined),
      book.handTurn ? undefined : 'cover',
    );
  return {
    left: between(leaf[3], leaf[2], 0.72),
    right: page[2],
  };
}
/** Keep the two cover grips with the same hands while the book crosses the body. */
export function bookHandsOrder(leftShoulderX: number, rightShoulderX: number) {
  return leftShoulderX <= rightShoulderX
    ? (['left', 'right'] as const)
    : (['right', 'left'] as const);
}
export function bookPage(book: BookFrame, contentAspect?: number): Quad | undefined {
  if (contentAspect !== undefined && (!Number.isFinite(contentAspect) || contentAspect <= 0))
    throw new Error('Book content aspect must be finite and positive');
  const { open } = fold(book);
  if (open < 0.55) return undefined;
  const corners = heldPage(book),
    inset = 0.1;
  const center = {
    x: corners.reduce((n, p) => n + p.x, 0) / 4,
    y: corners.reduce((n, p) => n + p.y, 0) / 4,
  };
  const page = transferredPoints(
    book,
    corners.map((p) => between(p, center, inset)) as unknown as Quad,
    'page',
  );
  if (contentAspect === undefined) return page;
  const map = projective(page, 1, 1);
  if (!map) return undefined;
  const width = Math.min(1, contentAspect / notebookPageAspect),
    height = Math.min(1, notebookPageAspect / contentAspect),
    left = (1 - width) / 2,
    top = (1 - height) / 2;
  return [
    map.at(left, top),
    map.at(left + width, top),
    map.at(left + width, top + height),
    map.at(left, top + height),
  ];
}
type Face = {
  name?: NotebookFace;
  points: Quad;
  fill: string;
  stroke: string;
  width: number;
};
function bookFaces(book: BookFrame): Face[] {
  const { open, w, h, cx } = fold(book),
    s = book.scale,
    cy = book.y;
  const face = (
    name: NotebookFace | undefined,
    xy: number[][],
    fill: string,
    stroke = stageInk,
    width = 2.7 * s,
  ): Face => ({
    name,
    points: xy.map(([x, y]) => ({ x: cx + x!, y: cy + y! })) as unknown as Quad,
    fill,
    stroke,
    width,
  });
  const faces: Face[] = [
    face(
      'back',
      [
        [0, -h * 0.63],
        [w + 5 * s, -h * 0.9],
        [w + 5 * s, h * 0.38],
        [0, h * 0.62],
      ],
      book.color,
    ),
    face(
      'side',
      [
        [w, -h],
        [w, h * 0.15],
        [w, h * 0.15],
        [w, -h],
      ],
      '#d6dbd8',
      stageInk,
      0,
    ),
    face(
      'end',
      [
        [0, h * 0.42],
        [w, h * 0.15],
        [w, h * 0.15],
        [0, h * 0.42],
      ],
      '#e3e5df',
      stageInk,
      0,
    ),
    face(
      'spine',
      [
        [0, -h * 0.65],
        [0, -h * 0.65],
        [0, h * 0.42],
        [0, h * 0.42],
      ],
      book.color,
      stageInk,
      0,
    ),
    face(
      'head',
      [
        [0, -h * 0.65],
        [w, -h],
        [w, -h],
        [0, -h * 0.65],
      ],
      '#d6dbd8',
      stageInk,
      0,
    ),
    face(
      'paper',
      [
        [0, -h * 0.65],
        [w, -h],
        [w, h * 0.15],
        [0, h * 0.42],
      ],
      '#ece9dc',
      stageInk,
      0,
    ),
    face(
      'page',
      [
        [0, -h * 0.65],
        [w, -h],
        [w, h * 0.15],
        [0, h * 0.42],
      ],
      '#ece9dc',
    ),
    {
      name: 'cover',
      points: heldLeaf(book),
      fill: open < 0.5 ? book.color : '#f6f4e9',
      stroke: stageInk,
      width: 2.7 * s,
    },
  ];
  if (open < 0.08)
    faces.push(
      face(
        'label',
        [
          [w * 0.22, -h * 0.56],
          [w * 0.78, -h * 0.69],
          [w * 0.78, 0],
          [w * 0.22, h * 0.16],
        ],
        book.color,
        '#c9ad70',
      ),
    );
  return faces;
}
function transferred(book: BookFrame, face: Face) {
  const target = book.resting?.faces.find((f) => f.name === face.name),
    restingStroke = target?.stroke ?? book.resting?.faces.find((f) => f.name === 'page')?.stroke,
    weight = book.resting?.weight ?? 0;
  const ink = (a: string, b: string) => {
    const from = color(a),
      to = color(b);
    for (const channel of ['r', 'g', 'b', 'a'] as const)
      from[channel] += (to[channel] - from[channel]) * weight;
    return from;
  };
  return {
    points: transferredPoints(book, face.points, face.name),
    fill: ink(face.fill, target?.fill ?? face.fill),
    stroke: ink(face.stroke, stageInk),
    width: face.width + ((restingStroke ?? face.width) - face.width) * weight,
  };
}
function turningPage(book: BookFrame): Face | undefined {
  const { open } = fold(book);
  if (!(book.turn > 0.001 && book.turn < 0.999 && open > 0.99)) return;
  return {
    points: heldLeaf(book, book.turn),
    fill: book.turn < 0.5 ? '#fcfbf3' : '#dcdacb',
    stroke: stageInk,
    width: 2.7 * book.scale,
  };
}
export function bookBounds(book: BookFrame) {
  const turn = turningPage(book),
    faces = bookFaces(book);
  if (turn) faces.push(turn);
  const points = faces.flatMap((face) => transferred(book, face).points);
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
export function drawBook(
  renderer: CharacterCompositor,
  book: BookFrame,
  height: number,
  content?: () => void,
) {
  const { open } = fold(book),
    s = book.scale;
  const poly = (face: Face) => {
    const { points, fill, stroke, width } = transferred(book, face);
    const area = points.reduce((sum, p, i) => {
      const next = points[(i + 1) % points.length]!;
      return sum + p.x * next.y - p.y * next.x;
    }, 0);
    if (Math.abs(area) < 1e-8) return;
    renderer.polygon(
      points.map((p) => ({ x: p.x, y: height - p.y })),
      fill,
      stroke,
      width,
    );
  };
  const faces = bookFaces(book);
  for (const face of faces) poly(face);
  if (open > 0.92 && !content) {
    for (const face of faces.filter((face) => face.name === 'page' || face.name === 'cover')) {
      const { points, width } = transferred(book, { ...face, width: 1.5 * s });
      const map = projective(points, 1, 1);
      if (!map) continue;
      for (let row = 0; row < 4; row++) {
        const y = 0.28 + row * 0.16,
          a = map.at(0.15, y),
          b = map.at(0.75, y);
        renderer.segment(
          { x: a.x, y: height - a.y },
          { x: b.x, y: height - b.y },
          width,
          color('#a2a192'),
        );
      }
    }
  }
  content?.();
  const turn = turningPage(book);
  if (turn) poly(turn);
}
