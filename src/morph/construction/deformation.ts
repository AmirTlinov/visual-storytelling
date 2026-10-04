import { boundsOf, padded, finite, lerp, rect, sample, number } from './geometry.js';
import type { ConstructionModel, ConstructionOperation, DiagramPoint } from './types.js';

/** A mathematical map transports one fixed material domain, its grid and its written strokes. */
export function deformation(
  operation: Extract<ConstructionOperation, { model: 'deform' }>,
): ConstructionModel {
  const {
    domain,
    parameter,
    map,
    grid = [6, 4],
    text = '',
    label = 'Деформация материала',
  } = operation;
  finite(...domain.flat(), ...parameter, ...grid);
  if (
    domain[1].some((v, i) => v <= domain[0][i]!) ||
    grid.some((v) => !Number.isInteger(v) || v < 1 || v > 24)
  )
    throw new Error('A material map needs increasing bounds and 1…24 grid divisions');
  const checked = (point: DiagramPoint, parameter: number): DiagramPoint => {
    const next = map([point[0], point[1]], parameter);
    if (!Array.isArray(next) || next.length !== 2)
      throw new Error('A material map must return [x, y]');
    finite(...next);
    return [next[0], next[1]];
  };
  const locations = sample(
    (t) => [lerp(domain[0][0], domain[1][0], t), domain[0][1]],
    0,
    1,
    24,
  ).flatMap(([x]) => sample((t) => [x, lerp(domain[0][1], domain[1][1], t)], 0, 1, 16));
  const envelope = operation.bounds
    ? boundsOf(operation.bounds)
    : boundsOf(
        Array.from({ length: 33 }, (_, i) =>
          locations.map((point) => checked(point, lerp(parameter[0], parameter[1], i / 32))),
        ).flat(),
      );
  if (operation.bounds && operation.bounds[1].some((v, i) => v <= operation.bounds![0][i]!))
    throw new Error('A material map range needs increasing bounds');
  return {
    stages: 1,
    result: parameter[1],
    sample(_stage, p) {
      const value = lerp(parameter[0], parameter[1], p);
      // A finite temporal sample cannot bound every user map. Include this
      // frame's measured material before padding; seeking never retains history.
      const bounds = padded(
        boundsOf([...envelope, ...locations.map((point) => checked(point, value))]),
      );
      return {
        panels: [
          {
            id: 'material-map',
            title: label,
            bounds,
            patches: [
              {
                ...rect('material', domain, 'blue', text),
                grid,
                map: (point) => checked(point, value),
              },
            ],
          },
        ],
        formula: `Параметр: ${number(value)}`,
        explanation:
          'Клетки и каждый штрих надписи следуют одной карте и деформируются вместе с материалом.',
      };
    },
  };
}
