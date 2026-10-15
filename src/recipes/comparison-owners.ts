import { comparisonModel } from './comparison-model.js';
import { comparisonSubject } from './comparison-subject.js';
import { leverModel, leverInputKeys } from './lever-model.js';
import { leverSubject } from './lever.js';
import { instructionalRouteModel } from './dependency-route-model.js';
import { instructionalRouteSubject } from './dependency-route-subject.js';
import type { StoryView } from '../story/model.js';
import type { LeverState } from '../math/lever.js';
import { rationalNumber } from '../math/rational.js';
const leverViews = (id: string): readonly StoryView[] => [
  { id: `${id}:diagram`, kind: 'lever', model: id },
];
const routeViews = (id: string): readonly StoryView[] => [
  { id: `${id}:network`, kind: 'dependency-network', model: id },
  { id: `${id}:status`, kind: 'order-status', model: id },
];
export const leverComparisonModel = comparisonModel({
  module: 'lever',
  model: leverModel,
  keys: leverInputKeys,
  views: leverViews,
});
export const routeComparisonModel = comparisonModel({
  module: 'dependency-route',
  model: instructionalRouteModel,
  keys: ['reserve'],
  views: routeViews,
});
export const leverComparisonSubject = comparisonSubject({
  model: leverComparisonModel,
  parameters: leverSubject().parameters,
  frame: { width: 1280, height: 960, scope: 'stage' },
  changes: leverInputKeys,
  views: leverViews,
  recipe(pair) {
    const states = [pair.before.state, pair.after.state] as unknown as LeverState[];
    // The union of both cases sets one physical scale; neither case fits itself.
    const maxForce = Math.max(
      1,
      ...states.flatMap((state) => [
        rationalNumber(state.left.force),
        rationalNumber(state.right.force),
        state.left.arm.numerator === 0 && state.right.arm.numerator === 0
          ? rationalNumber(state.requiredVerticalReaction)
          : 0,
      ]),
    );
    const maxArm = Math.max(
      1,
      ...states.flatMap((state) => [
        rationalNumber(state.left.arm) * 100,
        rationalNumber(state.right.arm) * 100,
      ]),
    );
    return leverSubject({ maxForce, maxArm });
  },
});
export const routeComparisonSubject = comparisonSubject({
  model: routeComparisonModel,
  parameters: instructionalRouteSubject.parameters,
  frame: { width: 1280, height: 960, scope: 'scene' },
  changes: ['reserve'],
  views: routeViews,
  recipe: () => instructionalRouteSubject,
});
