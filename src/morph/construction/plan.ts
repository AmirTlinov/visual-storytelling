import { smooth } from '../numbers.js';
import type { ConstructionModel, ConstructionPlan } from './types.js';

/** One narrative cadence for authored relations and the supplied mathematical recipes. */
export function stagedConstruction(model: ConstructionModel): ConstructionPlan {
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
