import type { SceneRenderer } from '@esotericsoftware/spine-webgl';
import { color } from './furniture.js';
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
export function bookHands(book: BookFrame) {
  const { w, h, cx, edge, lift } = fold(book);
  return {
    left: { x: cx - w, y: book.y + h * 0.15 },
    right: {
      x: cx + (book.handTurn ? Math.cos(Math.PI * book.handTurn) * w : edge) * 0.72,
      y:
        book.y +
        h * 0.2256 -
        (book.handTurn ? Math.sin(Math.PI * book.handTurn) * h * 1.3 : lift) * 0.72,
    },
  };
}
export function drawBook(renderer: SceneRenderer, book: BookFrame, height: number) {
  const { open, w, h, cx, edge, lift } = fold(book),
    s = book.scale,
    cy = book.y;
  const poly = (xy: number[][], fill: string, stroke = stageInk) => {
    const ps = xy.flatMap(([x, y]) => [cx + x!, height - cy - y!]),
      c = color(fill);
    for (let i = 2; i < xy.length; i++)
      renderer.triangle(
        true,
        ps[0]!,
        ps[1]!,
        ps[(i - 1) * 2]!,
        ps[(i - 1) * 2 + 1]!,
        ps[i * 2]!,
        ps[i * 2 + 1]!,
        c,
        c,
        c,
      );
    for (let i = 0; i < xy.length; i++) {
      const a = xy[i]!,
        b = xy[(i + 1) % xy.length]!;
      renderer.rectLine(
        true,
        cx + a[0]!,
        height - cy - a[1]!,
        cx + b[0]!,
        height - cy - b[1]!,
        2.7 * s,
        color(stroke),
      );
    }
  };
  poly(
    [
      [-w - 5 * s, -h * 0.9],
      [0, -h * 0.63],
      [0, h * 0.62],
      [-w - 5 * s, h * 0.38],
    ],
    book.color,
  );
  poly(
    [
      [-w, -h],
      [0, -h * 0.65],
      [0, h * 0.42],
      [-w, h * 0.15],
    ],
    '#ece9dc',
  );
  // A closed book shows its cover; the turning front cover reveals the page beneath it.
  poly(
    [
      [0, -h * 0.65],
      [edge, -h - lift],
      [edge, h * 0.15 - lift],
      [0, h * 0.42],
    ],
    open < 0.5 ? book.color : '#f6f4e9',
  );
  if (open > 0.92) {
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
  if (open < 0.08) {
    poly(
      [
        [-w * 0.78, -h * 0.69],
        [-w * 0.22, -h * 0.56],
        [-w * 0.22, h * 0.16],
        [-w * 0.78, 0],
      ],
      book.color,
      '#c9ad70',
    );
  }
  if (book.turn > 0.001 && book.turn < 0.999 && open > 0.99) {
    const x = Math.cos(Math.PI * book.turn) * w,
      raise = Math.sin(Math.PI * book.turn) * h * 1.3;
    poly(
      [
        [0, -h * 0.65],
        [x, -h - raise],
        [x, h * 0.15 - raise],
        [0, h * 0.42],
      ],
      book.turn < 0.5 ? '#fcfbf3' : '#dcdacb',
    );
  }
}
