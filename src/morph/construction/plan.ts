import { smooth } from '../numbers.js';
import { distribution, linearMap } from './algebra.js';
import { projection } from './trigonometry.js';
import { derivative, integral } from './calculus.js';
import { spring } from './dynamics.js';
import { deformation } from './deformation.js';
import type { ConstructionOperation, ConstructionModel, ConstructionPlan } from './types.js';

export function constructionPlan(
  operation: ConstructionOperation | ConstructionPlan,
): ConstructionPlan {
  if ('sample' in operation) return operation;
  let model: ConstructionModel;
  switch (operation.model) {
    case 'distribute':
      model = distribution(operation.a, operation.b, operation.c);
      break;
    case 'linear':
      model = linearMap(operation.matrix);
      break;
    case 'projection':
      model = projection(operation.angle);
      break;
    case 'derivative':
      model = derivative(operation.fn, operation.at, operation.span, operation.label);
      break;
    case 'integral':
      model = integral(operation.fn, operation.from, operation.to, operation.label);
      break;
    case 'spring':
      model = spring(operation.mass, operation.stiffness, operation.amplitude);
      break;
    case 'deform':
      model = deformation(operation);
      break;
    default:
      throw new Error('Unknown mathematical construction');
  }
  return {
    encoding: 'construction',
    stages: model.stages,
    result: model.result,
    sample(progress) {
      if (!Number.isFinite(progress)) throw new Error('Construction progress must be finite');
      const t = Math.max(0, Math.min(1, progress)) * model.stages;
      const stage = Math.min(model.stages - 1, Math.floor(t)),
        local = t - stage;
      const motion = smooth((local - 0.1) / 0.72);
      return {
        ...model.sample(stage, motion),
        stage,
        phase: local >= 0.82 ? 'hold' : 'move',
        result: stage === model.stages - 1 && local >= 0.82 ? model.result : undefined,
      };
    },
  };
}
