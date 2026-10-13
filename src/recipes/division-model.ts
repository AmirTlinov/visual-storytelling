import { divisionState } from '../math/division.js';
import type { StoryModelModule } from '../story/model.js';

/** The finite individual-object drawing owns these limits; integer arithmetic remains unbounded. */
export const divisionModel: StoryModelModule = {
  validateInputs(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('division.inputs: expected count and divisor.');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => !['count', 'divisor'].includes(key)))
      throw new Error('division.inputs: choose count or divisor.');
    const state = divisionState(input.count as number, input.divisor as number);
    if (state.count > 36 || state.divisor > 12)
      throw new Error('groups: this drawing supports count ≤ 36 and divisor ≤ 12.');
    return { count: state.count, divisor: state.divisor };
  },
  state: (inputs) => ({ ...inputs, progress: 0 }),
  staticState: (inputs) => ({ ...inputs, progress: 1 }),
  operations: {
    gather: (state) => ({ ...state, progress: 0 }),
    group: (state, progress) => ({ ...state, progress }),
    remainder: (state) => ({ ...state, progress: 1 }),
  },
  validateViews(views) {
    if (
      !views.length ||
      views.length > 2 ||
      !views.some((view) => view.kind === 'groups') ||
      views.some((view) => !['groups', 'equation'].includes(view.kind)) ||
      new Set(views.map((view) => view.kind)).size !== views.length
    )
      throw new Error('division.views: require one groups view and optionally one equation view.');
  },
  validateSequence(operations) {
    let grouped = false;
    for (const operation of operations) {
      if (operation === 'remainder' && !grouped)
        throw new Error('division: group the objects before naming the remainder.');
      if (operation === 'gather') grouped = false;
      if (operation === 'group') grouped = true;
    }
  },
  focusTargets: (model, views) => [...views.map((view) => view.id), `${model.id}:remainder`],
};
