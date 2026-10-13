import { compareModelSnapshots } from '../story/comparison.js';
import type { StoryModelModule, StoryModel, ModelValues, StoryView } from '../story/model.js';
const computed = ['comparison', 'comparisonProgress'];
const reserved = ['comparisonChange', 'comparisonValue', 'comparisonCase', ...computed];
export function comparisonModel({
  module: domainModule,
  model: owner,
  keys,
  views,
}: {
  module: string;
  model: StoryModelModule;
  keys: readonly string[];
  views(id: string): readonly StoryView[];
}): StoryModelModule {
  const normalize = (value: unknown): ModelValues => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Supply comparison conditions.');
    const input = value as ModelValues;
    if (computed.some((key) => Object.hasOwn(input, key)))
      throw new Error('Computed comparison facts are not editable conditions.');
    const baseline = owner.validateInputs(
      Object.fromEntries(Object.entries(input).filter(([key]) => !reserved.includes(key))),
    );
    if (Object.keys(baseline).some((key) => reserved.includes(key)))
      throw new Error('Domain inputs cannot replace comparison conditions.');
    const change = String(input.comparisonChange),
      next = input.comparisonValue;
    if (!keys.includes(change) || next === undefined)
      throw new Error('Select one comparison change and value.');
    owner.validateInputs({ ...baseline, [change]: next });
    const comparisonCase = input.comparisonCase ?? 'after';
    if (!['before', 'after'].includes(String(comparisonCase)))
      throw new Error('Select before or after.');
    return { ...baseline, comparisonChange: change, comparisonValue: next, comparisonCase };
  };
  const state = (value: ModelValues, progress: number, model?: StoryModel) => {
    if (!Number.isFinite(progress) || progress < 0 || progress > 1)
      throw new Error('Comparison reveal progress lies in[0,1].');
    const inputs = normalize(
      Object.fromEntries(Object.entries(value).filter(([key]) => !computed.includes(key))),
    );
    const baseline = Object.fromEntries(
      Object.entries(inputs).filter(([key]) => !reserved.includes(key)),
    );
    const domain = {
      id: model?.id ?? 'comparison',
      module: domainModule,
      inputs: baseline,
    };
    return {
      ...inputs,
      comparison: compareModelSnapshots(owner, domain, {
        [String(inputs.comparisonChange)]: inputs.comparisonValue!,
      }),
      comparisonProgress: progress,
    };
  };
  return {
    validateInputs: normalize,
    state: (inputs, model) => state(inputs, 0, model),
    staticState: (inputs, model) => state(inputs, 1, model),
    experimentState: (inputs, authored, model) =>
      state(inputs, Number(authored.comparisonProgress), model),
    operations: {
      baseline: (previous, _p, model) => state(previous as ModelValues, 0, model),
      change: (previous, p, model) => state(previous as ModelValues, p, model),
      compare: (previous, _p, model) => state(previous as ModelValues, 1, model),
    },
    validateViews(views) {
      if (views.length !== 1 || views[0]!.kind !== 'comparison')
        throw new Error('Require one comparison view.');
    },
    validateSequence(operations) {
      let previous = -1;
      for (const operation of operations) {
        const index = ['baseline', 'change', 'compare'].indexOf(operation);
        if (index <= previous)
          throw new Error('Comparison actions advance once through baseline, change, compare.');
        if (operation === 'compare' && previous < 1)
          throw new Error('Apply the selected change before comparing.');
        previous = index;
      }
    },
    focusTargets(model, documentViews) {
      const pair = state(model.inputs, 1, model).comparison;
      return [
        ...documentViews.map((view) => view.id),
        ...(['before', 'after'] as const).flatMap((side) =>
          owner.focusTargets(
            { id: pair[side].id, module: domainModule, inputs: pair[side].inputs },
            views(pair[side].id),
          ),
        ),
      ];
    },
  };
}
