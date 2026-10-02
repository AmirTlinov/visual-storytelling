import { svg } from './dom.js';

/** Exact quiet felt-tip treatment from visual-explainer/assets/ink-marks.js. */
export function marker(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  seed: number,
) {
  const n = (v: number) => +v.toFixed(3);
  const element = svg('g', {
    class: 'vs-marker',
    transform: `translate(${x} ${y}) scale(${width} ${height})`,
    stroke: 'none',
  });
  const defs = svg('defs'),
    gradient = svg('linearGradient', { id: `${id}-fade` });
  for (const [offset, opacity] of [
    [0, 0],
    [0.008, 0.5],
    [0.019, 1],
    [0.981, 1],
    [0.992, 0.55],
    [1, 0],
  ])
    gradient.append(
      svg('stop', { offset: offset!, 'stop-opacity': opacity!, 'stop-color': 'white' }),
    );
  const mask = svg('mask', {
    id: `${id}-ends`,
    maskUnits: 'objectBoundingBox',
    maskContentUnits: 'objectBoundingBox',
    x: '-.1',
    y: '-.1',
    width: '1.2',
    height: '1.2',
  });
  mask.append(svg('rect', { x: 0, y: '-.1', width: 1, height: '1.2', fill: `url(#${id}-fade)` }));
  const filter = svg('filter', {
    id: `${id}-soft`,
    x: '-10%',
    y: '-10%',
    width: '120%',
    height: '120%',
    primitiveUnits: 'objectBoundingBox',
    'color-interpolation-filters': 'sRGB',
  });
  filter.append(svg('feGaussianBlur', { stdDeviation: '.0015 .006' }));
  defs.append(gradient, mask, filter);
  element.append(defs);
  element.setAttribute('filter', `url(#${id}-soft)`);
  element.setAttribute('mask', `url(#${id}-ends)`);
  const wave = 0.012 * Math.sin(seed * 2.1 + 0.7),
    edge = 0.008 * Math.cos(seed * 1.3 + 0.9);
  element.append(
    svg('path', {
      d: `M.016 .05 Q.24 ${n(-wave)} .5 .025 T.983 ${n(0.04 + wave)} Q1 ${n(0.32 + edge)} .99 .54 T.98 .96 Q.73 ${n(1 + wave)} .51 .978 T.018 ${n(0.966 - wave)} Q${n(-edge)} .7 .01 .5 T.016 .05Z`,
    }),
  );
  element.append(
    svg('path', {
      d: `M.017 .69 Q.31 ${n(0.67 + wave)} .61 .69 T.985 .7 L.983 .85 Q.69 .82 .37 .85 T.016 .84Z`,
      opacity: '.045',
    }),
  );
  return element;
}
