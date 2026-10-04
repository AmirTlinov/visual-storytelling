import { createModel, type Coordinate, type Domain } from '../model/index.js';
import { number } from './geometry.js';
import type { ConstructionPlan } from './types.js';

export interface DeformationOptions {
  domain: Domain;
  bounds?: readonly [Coordinate, Coordinate];
  parameter: readonly [number, number];
  map(point: Coordinate, parameter: number): Coordinate;
  grid?: readonly [number, number];
  text?: string;
  label?: string;
}

/** The general material map owns geometry, grid and writing; this recipe only supplies its state. */
export function deformation(operation: DeformationOptions): ConstructionPlan {
  const {
    domain,
    parameter,
    map,
    grid = [6, 4],
    text = '',
    label = 'Деформация материала',
  } = operation;
  const model = createModel({ parameter: parameter[0] });
  const material = model.material((point, state) => map([point[0]!, point[1]!], state.parameter), {
    domain,
    grid,
    text,
    fill: true,
  });
  return model.explain({
    panels: [{ title: label, objects: [material], bounds: operation.bounds }],
    steps: [
      {
        to: { parameter: parameter[1] },
        formula: model.parameter('parameter').map((value) => `Параметр: ${number(value)}`),
        explanation:
          'Клетки и каждый штрих надписи следуют одной карте и деформируются вместе с материалом.',
      },
    ],
    result: model.parameter('parameter'),
  });
}
