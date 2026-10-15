export default {
  validateInputs(value) {
    if (
      !value ||
      Object.keys(value).some((key) => key !== 'count') ||
      !Number.isSafeInteger(value.count) ||
      value.count < 0 ||
      value.count > 99
    )
      throw new Error('count: choose 0–99');
    return { count: value.count };
  },
  state: (inputs) => ({ ...inputs }),
  operations: { increment: (state) => ({ ...state, count: state.count + 1 }) },
  validateViews(views) {
    if (views.length !== 1 || views[0].kind !== 'counter') throw new Error('counter view required');
  },
  focusTargets: (_model, views) => views.map((view) => view.id),
};
