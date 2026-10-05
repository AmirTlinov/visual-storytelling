import type { SceneRenderer } from '@esotericsoftware/spine-webgl';
import { color } from './furniture.js';
import { projective, type Quad, type XY } from '../../ink/projective.js';
import type { notebookFaces, NotebookFace } from './notebook.js';
import { stageInk } from './geometry.js';

export interface BookFrame {
  id: string;
  x: number;
  y: number;
  scale: number;
  turn: number;
  handTurn: number;
  color: string;
  open?: number;
  /** The existing transfer phase tilts the same vertices onto their physical support. */
  resting?: { faces: ReturnType<typeof notebookFaces>; weight: number };
}
/** The cover, page and fingers share the same fold geometry. */
function fold(book: BookFrame) {
  const open = book.open ?? 1,
    w = 82 * book.scale,
    h = 42 * book.scale;
  return {
    open,
    w,
    h,
    cx: book.x + ((1 - open) * w) / 2,
    edge: -Math.cos(Math.PI * open) * w,
    lift: Math.sin(Math.PI * open) * h * 0.95,
  };
}
function heldPage(book: BookFrame): Quad {
  const { w, h, cx } = fold(book),
    cy = book.y;
  return [
    { x: cx - w, y: cy - h },
    { x: cx, y: cy - h * 0.65 },
    { x: cx, y: cy + h * 0.42 },
    { x: cx - w, y: cy + h * 0.15 },
  ];
}
const restingOrder = (name: NotebookFace, points: Quad): Quad => {
  // Held cover is listed from its top-right corner; the physical cover starts top-left.
  // Match visual corners without reflecting the plane during the transfer.
  return name === 'cover' ? [points[1], points[0], points[3], points[2]] : points;
};
/** Fingers follow the same plane as the cover throughout a take or put. */
function restingPoint(book: BookFrame, point: XY): XY {
  const resting = book.resting;
  if (!resting?.weight) return point;
  const cover = resting.faces.find((face) => face.name === 'cover')!;
  const from = projective(heldPage(book), 1, 1)!;
  const to = projective(restingOrder('page', cover.points), 1, 1)!;
  const uv = from.inverse(point.x, point.y),
    target = to.at(uv.x, uv.y);
  return {
    x: point.x + (target.x - point.x) * resting.weight,
    y: point.y + (target.y - point.y) * resting.weight,
  };
}
export function bookHands(book: BookFrame) {
  const { w, h, cx, edge, lift } = fold(book);
  return {
    left: restingPoint(book, { x: cx - w, y: book.y + h * 0.15 }),
    right: restingPoint(book, {
      x: cx + (book.handTurn ? Math.cos(Math.PI * book.handTurn) * w : edge) * 0.72,
      y:
        book.y +
        h * 0.2256 -
        (book.handTurn ? Math.sin(Math.PI * book.handTurn) * h * 1.3 : lift) * 0.72,
    }),
  };
}
export function bookPage(book: BookFrame): Quad | undefined {
  const { open, h, cx, edge, lift } = fold(book);
  if (open < 0.55) return undefined;
  const cy = book.y,
    inset = 0.1;
  const corners = [
    { x: cx, y: cy - h * 0.65 },
    { x: cx + edge, y: cy - h - lift },
    { x: cx + edge, y: cy + h * 0.15 - lift },
    { x: cx, y: cy + h * 0.42 },
  ];
  const center = {
    x: corners.reduce((n, p) => n + p.x, 0) / 4,
    y: corners.reduce((n, p) => n + p.y, 0) / 4,
  };
  return corners.map((p) => ({
    x: p.x + (center.x - p.x) * inset,
    y: p.y + (center.y - p.y) * inset,
  })) as unknown as Quad;
}
type Face = {
  name?: NotebookFace;
  points: Quad;
  fill: string;
  stroke: string;
  width: number;
};
function bookFaces(book: BookFrame): Face[] {
  const { open, w, h, cx, edge, lift } = fold(book),
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
  const faces = [
    face(
      'back',
      [
        [-w - 5 * s, -h * 0.9],
        [0, -h * 0.63],
        [0, h * 0.62],
        [-w - 5 * s, h * 0.38],
      ],
      book.color,
    ),
    face(
      'side',
      [
        [0, -h * 0.65],
        [0, h * 0.42],
        [0, h * 0.42],
        [0, -h * 0.65],
      ],
      '#d6dbd8',
      stageInk,
      0,
    ),
    face(
      'end',
      [
        [-w, h * 0.15],
        [0, h * 0.42],
        [0, h * 0.42],
        [-w, h * 0.15],
      ],
      '#e3e5df',
      stageInk,
      0,
    ),
    face(
      'spine',
      [
        [-w, -h],
        [-w, -h],
        [-w, h * 0.15],
        [-w, h * 0.15],
      ],
      book.color,
      stageInk,
      0,
    ),
    face(
      'head',
      [
        [-w, -h],
        [0, -h * 0.65],
        [0, -h * 0.65],
        [-w, -h],
      ],
      '#d6dbd8',
      stageInk,
      0,
    ),
    face(
      'paper',
      [
        [-w, -h],
        [0, -h * 0.65],
        [0, h * 0.42],
        [-w, h * 0.15],
      ],
      '#ece9dc',
      stageInk,
      0,
    ),
    face(
      'page',
      [
        [-w, -h],
        [0, -h * 0.65],
        [0, h * 0.42],
        [-w, h * 0.15],
      ],
      '#ece9dc',
    ),
    face(
      'cover',
      [
        [0, -h * 0.65],
        [edge, -h - lift],
        [edge, h * 0.15 - lift],
        [0, h * 0.42],
      ],
      open < 0.5 ? book.color : '#f6f4e9',
    ),
  ];
  if (open < 0.08)
    faces.push(
      face(
        'label',
        [
          [-w * 0.78, -h * 0.69],
          [-w * 0.22, -h * 0.56],
          [-w * 0.22, h * 0.16],
          [-w * 0.78, 0],
        ],
        book.color,
        '#c9ad70',
      ),
    );
  return faces;
}
function transferred(book: BookFrame, face: Face) {
  const target = book.resting?.faces.find((f) => f.name === face.name),
    weight = book.resting?.weight ?? 0;
  const points = target ? restingOrder(target.name, target.points) : face.points;
  const ink = (a: string, b: string) => {
    const from = color(a),
      to = color(b);
    for (const channel of ['r', 'g', 'b', 'a'] as const)
      from[channel] += (to[channel] - from[channel]) * weight;
    return from;
  };
  return {
    points: face.points.map((p, i) => ({
      x: p.x + (points[i]!.x - p.x) * weight,
      y: p.y + (points[i]!.y - p.y) * weight,
    })),
    fill: ink(face.fill, target?.fill ?? face.fill),
    stroke: ink(face.stroke, stageInk),
    width: face.width + ((target?.stroke ?? face.width) - face.width) * weight,
  };
}
function turningPage(book: BookFrame): Face | undefined {
  const { open, w, h, cx } = fold(book);
  if (!(book.turn > 0.001 && book.turn < 0.999 && open > 0.99)) return;
  const x = Math.cos(Math.PI * book.turn) * w,
    raise = Math.sin(Math.PI * book.turn) * h * 1.3,
    cy = book.y;
  return {
    points: [
      { x: cx, y: cy - h * 0.65 },
      { x: cx + x, y: cy - h - raise },
      { x: cx + x, y: cy + h * 0.15 - raise },
      { x: cx, y: cy + h * 0.42 },
    ],
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
  renderer: SceneRenderer,
  book: BookFrame,
  height: number,
  content?: () => void,
) {
  const { open, h, cx } = fold(book),
    s = book.scale,
    cy = book.y;
  const poly = (face: Face) => {
    const { points, fill, stroke, width } = transferred(book, face);
    const area = points.reduce((sum, p, i) => {
      const next = points[(i + 1) % points.length]!;
      return sum + p.x * next.y - p.y * next.x;
    }, 0);
    if (Math.abs(area) < 1e-8) return;
    for (let i = 2; i < points.length; i++) {
      const a = points[0]!,
        b = points[i - 1]!,
        c = points[i]!;
      renderer.triangle(
        true,
        a.x,
        height - a.y,
        b.x,
        height - b.y,
        c.x,
        height - c.y,
        fill,
        fill,
        fill,
      );
    }
    for (const [i, a] of points.entries()) {
      const b = points[(i + 1) % points.length]!;
      if (width > 0 && Math.hypot(a.x - b.x, a.y - b.y) > 1e-8)
        renderer.rectLine(true, a.x, height - a.y, b.x, height - b.y, width, stroke);
    }
  };
  for (const face of bookFaces(book)) poly(face);
  if (open > 0.92 && !content) {
    for (const side of [-1, 1])
      for (let row = 0; row < 4; row++) {
        const y = -h * 0.43 + row * 8 * s;
        renderer.rectLine(
          true,
          cx + side * 12 * s,
          height - cy - y,
          cx + side * 59 * s,
          height - cy - y + (side > 0 ? 6 : -6) * s,
          1.5 * s,
          color('#a2a192'),
        );
      }
  }
  content?.();
  const turn = turningPage(book);
  if (turn) poly(turn);
}
