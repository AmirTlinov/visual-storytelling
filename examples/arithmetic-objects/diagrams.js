import { regroup } from '@visual-storytelling/core';
import { balloon, coin, cell, pieHalf, group, label } from './drawing.js';

function move(items, from, to, progress) {
  regroup(from, to, progress).forEach(([x, y], i) => items[i].at(x, y));
}

export function addition(view) {
  const root = group(view, 'addition');
  const items = Array.from({ length: 4 }, (_, i) =>
    balloon(view, root.content, `balloon-${i}`, i < 2 ? 'blue' : 'orange'),
  );
  const left = label(root.content, 'our-balloons', 'У нас: 2', 23, 'blue');
  const right = label(root.content, 'new-balloons', 'Принесли: 2', 23, 'orange');
  return {
    root,
    height: () => 270,
    render({ width, progress }) {
      const starts = [
        width * 0.25 - 34,
        width * 0.25 + 34,
        width * 0.75 - 34,
        width * 0.75 + 34,
      ].map((x) => [x, 95]);
      const ends = [-105, -35, 35, 105].map((x) => [width / 2 + x, 160]);
      move(items, starts, ends, progress);
      left.at(width * 0.25, 36);
      right.at(width * 0.75, 36);
      left.show(progress < 1);
      right.show(progress < 1);
      return { visibleObjects: 4, total: 4, collected: progress === 1 ? 4 : undefined };
    },
  };
}

export function subtraction(view) {
  const root = group(view, 'subtraction');
  const pocket = group(view, 'recipient', 'orange');
  root.content.append(pocket.element);
  view.pen.path(
    pocket.content,
    'recipient-pocket',
    'M-78 -47 Q0 -38 78 -47 L68 39 Q0 66 -68 39 Z',
    { width: 1.3 },
  );
  view.pen.path(pocket.content, 'recipient-opening', 'M-78 -47 Q0 -58 78 -47', { width: 1 });
  const kept = label(root.content, 'kept', 'У нас', 22, 'blue');
  const given = label(root.content, 'given', 'Получатель', 22, 'orange');
  const items = Array.from({ length: 4 }, (_, i) =>
    coin(view, root.content, `coin-${i}`, i < 2 ? 'blue' : 'orange'),
  );
  return {
    root,
    height: (narrow) => (narrow ? 330 : 280),
    render({ width, narrow, progress }) {
      const originY = 85;
      const keepX = narrow ? width / 2 : width * 0.28;
      const giveX = narrow ? width / 2 : width * 0.74;
      const giveY = narrow ? 225 : 170;
      const starts = [-90, -30, 30, 90].map((x) => [keepX + x, originY]);
      const ends = [starts[0], starts[1], [giveX - 32, giveY], [giveX + 32, giveY]];
      pocket.at(giveX, giveY);
      kept.at(keepX - 60 * progress, originY - 62);
      given.at(giveX, giveY + 77);
      move(items, starts, ends, progress);
      return {
        visibleObjects: 4,
        total: 4,
        remaining: progress === 1 ? 2 : undefined,
        transferred: progress === 1 ? 2 : 0,
      };
    },
  };
}

export function multiplication(view) {
  const root = group(view, 'multiplication');
  const items = Array.from({ length: 4 }, (_, i) =>
    cell(view, root.content, `cell-${i}`, i < 2 ? 'blue' : 'orange'),
  );
  const first = label(root.content, 'first-copy', '1-я группа', 22, 'blue');
  const second = label(root.content, 'second-copy', '2-я группа', 22, 'orange');
  const route = group(view, 'repeat-route', 'purple');
  root.content.append(route.element);
  const arrow = view.pen.path(route.content, 'repeat-arrow', 'M0 0 C36 0 36 106 0 106', {
    width: 1.3,
  });
  const head = view.pen.path(route.content, 'repeat-head', 'M8 101 L0 106 L8 111', {
    width: 1.3,
  });
  const twice = label(route.content, 'repeat-word', 'ещё раз', 18, 'purple');
  twice.at(70, 61);
  return {
    root,
    height: () => 260,
    render({ width, progress }) {
      const x = width / 2;
      const starts = [
        [x - 30, 75],
        [x + 30, 75],
        [x - 30, 75],
        [x + 30, 75],
      ];
      const ends = [
        [x - 30, 75],
        [x + 30, 75],
        [x - 30, 181],
        [x + 30, 181],
      ];
      move(items, starts, ends, progress);
      for (const item of items.slice(2)) {
        item.show(progress > 0);
        item.element.style.opacity = String(Math.min(1, progress * 5));
      }
      first.at(x, 30);
      second.at(x, 241);
      second.show(progress > 0);
      route.at(x + 66, 75);
      route.show(progress > 0);
      arrow.reveal(progress);
      head.element.style.display = progress === 1 ? '' : 'none';
      return {
        visibleObjects: progress === 0 ? 2 : 4,
        total: progress === 1 ? 4 : 2,
        groups: progress === 1 ? 2 : 1,
        unitSize: 56,
      };
    },
  };
}

export function division(view) {
  const root = group(view, 'division');
  const plates = Array.from({ length: 4 }, (_, i) => {
    const plate = group(view, `plate-${i}`);
    root.content.append(plate.element);
    view.pen.ellipse(plate.content, `plate-${i}:rim`, 0, 0, 54, 54, { width: 1, stroke: 'pencil' });
    view.pen.ellipse(plate.content, `plate-${i}:inner`, 0, 0, 46, 46, {
      width: 0.6,
      stroke: 'pencil',
    });
    const name = label(plate.content, `plate-${i}:name`, `${i + 1}-я порция`, 18);
    name.at(0, 72);
    return { ...plate, name };
  });
  const halves = Array.from({ length: 4 }, (_, i) =>
    pieHalf(view, root.content, `pie-half-${i}`, i % 2 === 1, i < 2 ? 'orange' : 'blue'),
  );
  const original = label(root.content, 'whole-pies', '2 целых пирога', 23);
  return {
    root,
    height: (narrow) => (narrow ? 450 : 290),
    render({ width, narrow, progress, cut }) {
      const x = width / 2;
      const starts = [
        [x - 88, 80],
        [x - 88, 80],
        [x + 88, 80],
        [x + 88, 80],
      ];
      const targets = narrow
        ? [
            [96, 205],
            [width - 96, 205],
            [96, 365],
            [width - 96, 365],
          ]
        : [-228, -76, 76, 228].map((dx) => [x + dx, 195]);
      // Keep each cut perpendicular to separation: halves never pass through one another.
      const ends = halves.map((half, i) => {
        const [px, py] = targets[narrow ? [0, 2, 1, 3][i] : i];
        half.move(0, 0, narrow ? 90 : 0);
        return narrow ? [px, py - half.centroid] : [px - half.centroid, py];
      });
      move(halves, starts, ends, progress);
      halves.forEach((half) => half.cut(cut));
      plates.forEach((plate, i) => {
        plate.at(...targets[i]);
        plate.name.text(progress === 1 ? '½ пирога' : `${i + 1}-я порция`);
        plate.name.show(progress === 0 || progress === 1);
      });
      original.at(x, 20);
      original.show(progress === 0);
      return {
        visibleObjects: cut === 0 ? 2 : 4,
        pieces: 4,
        total: 2,
        portion: progress === 1 ? 0.5 : undefined,
        pieceAreas: [0.5, 0.5, 0.5, 0.5],
      };
    },
  };
}
