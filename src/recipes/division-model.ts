import { divisionParts } from './division-parts.js';
import { DIVISION_MAX_COUNT, DIVISION_MAX_DIVISOR } from './division-capacity.js';
import type { ModelValues, StoryModel } from '../story/model.js';
import { divisionState } from '../math/division.js';
import type { StoryModelModule } from '../story/model.js';

function measuredState(inputs: ModelValues, progress: number, model?: StoryModel) {
  const values = divisionModel.validateInputs(inputs);
  const result = divisionState(Number(values.count), Number(values.divisor), {
    id: model?.id ?? 'division',
  });
  return { ...values, progress, parts: divisionParts(result, progress) };
}

/** The finite individual-object drawing owns these limits; integer arithmetic remains unbounded. */
export const divisionModel: StoryModelModule = {
  validateInputs(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('division.inputs: expected count and divisor.');
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some((key) => !['count', 'divisor'].includes(key)))
      throw new Error('division.inputs: choose count or divisor.');
    const state = divisionState(input.count as number, input.divisor as number);
    if (state.count > DIVISION_MAX_COUNT || state.divisor > DIVISION_MAX_DIVISOR)
      throw new Error('groups: this drawing supports count ≤ 36 and divisor ≤ 12.');
    return { count: state.count, divisor: state.divisor };
  },
  state: (inputs, model) => measuredState(inputs, 0, model),
  staticState: (inputs, model) => measuredState(inputs, 1, model),
  experimentState: (inputs, authored, model) =>
    measuredState(inputs, Number(authored.progress), model),
  operations: {
    gather: (state, _progress, model) =>
      measuredState({ count: state.count as number, divisor: state.divisor as number }, 0, model),
    group: (state, progress, model) =>
      measuredState(
        { count: state.count as number, divisor: state.divisor as number },
        progress,
        model,
      ),
    remainder: (state, _progress, model) =>
      measuredState({ count: state.count as number, divisor: state.divisor as number }, 1, model),
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
