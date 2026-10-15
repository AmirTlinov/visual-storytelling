import type { StoryModelModule } from '../story/model.js';

/** The switch operations are shared by authored chapters and direct JavaScript callers. */
export const circuitModel: StoryModelModule = {
  validateInputs(value) {
    if (
      !value ||
      typeof value !== 'object' ||
      Array.isArray(value) ||
      Object.keys(value).some((key) => key !== 'closed') ||
      typeof (value as { closed?: unknown }).closed !== 'boolean'
    )
      throw new Error('circuit.inputs: expected a boolean closed.');
    return { closed: (value as { closed: boolean }).closed };
  },
  state: (inputs) => ({ ...inputs }),
  experimentState: (inputs) => ({ ...inputs }),
  operations: {
    open: (state) => ({ ...state, closed: false }),
    close: (state) => ({ ...state, closed: true }),
  },
  validateViews(views) {
    if (views.length !== 1 || views[0]!.kind !== 'circuit')
      throw new Error('circuit.views: require one circuit view.');
  },
  focusTargets: (model, views) => [
    ...views.map((view) => view.id),
    `${model.id}:switch`,
    `${model.id}:lamp`,
  ],
};
