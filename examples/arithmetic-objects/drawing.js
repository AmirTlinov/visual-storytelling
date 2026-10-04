import { object, lettering } from '@visual-storytelling/core';

export function label(parent, id, text, size = 21, pigment = 'ink') {
  const mark = object(parent, id, pigment);
  const ink = lettering(mark.content, text, { size });
  return { ...mark, text: ink.text };
}

export function balloon(view, parent, id, pigment) {
  const mark = object(parent, id, pigment);
  view.pen.ellipse(mark.content, `${id}:body`, 0, 0, 24, 31, { fill: 'marker' });
  view.pen.path(mark.content, `${id}:knot`, 'M-3 30 L-5 37 Q0 35 5 37 L3 30', { fill: 'marker' });
  view.pen.path(mark.content, `${id}:string`, 'M0 37 C-13 51 12 62 0 76 Q-4 81 -2 88', {
    width: 1.2,
  });
  view.pen.path(mark.content, `${id}:shine`, 'M-14 -7 Q-14 -18 -6 -21', {
    width: 1,
    stroke: 'pencil',
  });
  return mark;
}

export function coin(view, parent, id, pigment) {
  const mark = object(parent, id, pigment);
  view.pen.ellipse(mark.content, `${id}:edge`, 0, 0, 25, 25, { fill: 'marker' });
  view.pen.ellipse(mark.content, `${id}:rim`, 0, 0, 20, 20, { width: 0.8, stroke: 'pencil' });
  lettering(mark.content, '1', {
    bounds: { width: 36, height: 36, shape: 'ellipse', padding: 4 },
    size: 24,
  });
  return mark;
}

export function cell(view, parent, id, pigment) {
  const mark = object(parent, id, pigment);
  view.pen.rect(mark.content, `${id}:body`, -28, -28, 56, 56, { fill: 'marker' });
  return mark;
}

export function pieHalf(view, parent, id, right, pigment) {
  const mark = object(parent, id, pigment);
  const sign = right ? 1 : -1,
    radius = 44;
  const arc = `M0 -${radius} A${radius} ${radius} 0 0 ${right ? 1 : 0} 0 ${radius}`;
  view.pen.path(mark.content, `${id}:filling`, `${arc} Z`, { fill: 'marker', width: 0 });
  view.pen.path(mark.content, `${id}:crust`, arc, { width: 2.5 });
  view.pen.path(mark.content, `${id}:inner`, `M0 -38 A38 38 0 0 ${right ? 1 : 0} 0 38`, {
    width: 0.8,
  });
  const cut = view.pen.line(mark.content, `${id}:cut`, [0, -radius], [0, radius], { width: 1.1 });
  for (const [i, x, y] of [
    [0, 14, -19],
    [1, 26, 1],
    [2, 11, 21],
  ])
    view.pen.ellipse(mark.content, `${id}:fruit:${i}`, sign * x, y, 3.4, 3.4, {
      fill: 'marker',
      width: 1,
    });
  mark.element.dataset.value = '.5';
  return { ...mark, cut: cut.reveal, centroid: (sign * 4 * radius) / (3 * Math.PI) };
}

export function group(view, id, pigment = 'ink') {
  return object(view.layer, id, pigment);
}
