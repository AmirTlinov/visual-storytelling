import { test } from 'node:test';
import { stageColor } from '../dist/characters/compositor.js';
import assert from 'node:assert/strict';
import { bookBounds, bookHands, bookPage, drawBook } from '../dist/characters/staging/book.js';
import { notebookFaces } from '../dist/characters/staging/notebook.js';
import { readingRoom } from '../dist/characters/staging/sets.js';
import { projective } from '../dist/ink/projective.js';

const space = readingRoom().staging.projection;
const item = { kind: 'book', at: { x: 1.8, z: 3.2, height: 1.49 }, scale: 0.72, color: '#855057' };
const base = { id: 'book', x: 210, y: 520, scale: 0.63, turn: 0, handTurn: 0, color: item.color };
const close = (a, b) => {
  assert.ok(
    Math.hypot(a.x - b.x, a.y - b.y) < 1e-7,
    `${JSON.stringify(a)} != ${JSON.stringify(b)}`,
  );
};
function drawn(book, content) {
  const vertices = [],
    lines = [];
  drawBook(
    {
      polygon(points, fill, stroke, width) {
        vertices.push(...points.map((p) => ({ x: p.x, y: -p.y })));
        if (width > 0)
          for (const [i, a] of points.entries()) {
            const b = points[(i + 1) % points.length];
            lines.push({ a: { x: a.x, y: -a.y }, b: { x: b.x, y: -b.y }, width, color: stroke });
          }
      },
      segment(a, b, width, color) {
        lines.push({ a: { x: a.x, y: -a.y }, b: { x: b.x, y: -b.y }, width, color });
      },
    },
    book,
    0,
    content,
  );
  return { vertices, lines };
}
const points = (values) =>
  [...new Set(values.map(({ x, y }) => `${x.toFixed(5)},${y.toFixed(5)}`))].sort();

test('open and closed books keep their resting silhouette, contacts and readable right page through transfer', () => {
  for (const open of [0, 1]) {
    const faces = notebookFaces({ ...item, open }, space),
      end = { ...base, open, resting: { faces, weight: 1 } };
    assert.deepEqual(points(drawn(end, () => {}).vertices), points(faces.flatMap((f) => f.points)));
    assert.equal(
      faces.some((f) => f.name === 'label'),
      open === 0,
    );
    if (open) assert.equal(faces.find((f) => f.name === 'cover').fill, '#f6f4e9');
    const page = faces.find((f) => f.name === 'page').points,
      cover = faces.find((f) => f.name === 'cover').points,
      hands = bookHands(end);
    close(hands.right, page[2]);
    close(hands.left, {
      x: cover[3].x + (cover[2].x - cover[3].x) * 0.72,
      y: cover[3].y + (cover[2].y - cover[3].y) * 0.72,
    });
    if (open) bookPage(end).forEach((p, i) => close(p, page[i]));
    else assert.equal(bookPage(end), undefined);
    for (let i = 0; i <= 40; i++) {
      const book = { ...base, open, resting: { faces, weight: i / 40 } },
        contacts = bookHands(book);
      assert.ok(contacts.left.x < contacts.right.x, 'the cover and base grips never cross');
      assert.ok(Object.values(bookBounds(book)).every(Number.isFinite));
      if (open) {
        const quad = bookPage(book);
        assert.ok(
          quad[0].x < quad[1].x && quad[3].x < quad[2].x,
          'the right page keeps reading order',
        );
        assert.ok(projective(quad, 1, 1));
      }
    }
  }
});

test('resting text and a turning leaf leave no marks at the former held position', () => {
  const faces = notebookFaces({ ...item, open: 1 }, space),
    book = { ...base, open: 1, resting: { faces, weight: 1 } },
    maps = faces
      .filter((f) => ['page', 'cover'].includes(f.name))
      .map((f) => projective(f.points, 1, 1));
  const rules = drawn(book).lines.filter(
    (line) => Math.abs(line.color.r - stageColor('#a2a192').r) < 1e-10,
  );
  assert.equal(rules.length, 8);
  for (const line of rules)
    for (const p of [line.a, line.b])
      assert.ok(
        maps.some((map) => {
          const uv = map.inverse(p.x, p.y);
          return uv.x > 0 && uv.x < 1 && uv.y > 0 && uv.y < 1;
        }),
        'a text rule lies outside both resting pages',
      );
  const turn = { ...book, turn: 0.36, handTurn: 0.36 },
    moved = { ...turn, x: 900, y: -120, scale: 1.2 },
    a = drawn(turn),
    b = drawn(moved);
  a.vertices.forEach((p, i) => close(p, b.vertices[i]));
  a.lines.forEach((line, i) => {
    close(line.a, b.lines[i].a);
    close(line.b, b.lines[i].b);
    assert.ok(Math.abs(line.width - b.lines[i].width) < 1e-10);
  });
  close(bookHands(turn).left, bookHands(moved).left);
});

test('book artwork keeps its intrinsic aspect within the physical portrait page', () => {
  const faces = notebookFaces({ ...item, open: 1 }, space),
    page = faces.find((face) => face.name === 'page'),
    book = { ...base, open: 1, resting: { faces, weight: 1 } },
    map = projective(page.points, 1, 1),
    width = page.world[1].x - page.world[0].x,
    height = page.world[0].z - page.world[3].z;
  for (const aspect of [2, 0.4]) {
    const uv = bookPage(book, aspect).map((p) => map.inverse(p.x, p.y));
    const actual = ((uv[1].x - uv[0].x) * width) / ((uv[3].y - uv[0].y) * height);
    assert.ok(Math.abs(actual - aspect) < 1e-10, 'the diagram stretches on the notebook');
    close({ x: (uv[0].x + uv[2].x) / 2, y: (uv[0].y + uv[2].y) / 2 }, { x: 0.5, y: 0.5 });
    assert.ok(
      uv.every((p) => p.x >= -1e-10 && p.x <= 1 + 1e-10 && p.y >= -1e-10 && p.y <= 1 + 1e-10),
    );
  }
  assert.throws(() => bookPage(book, 0), /aspect must be finite and positive/);
});
