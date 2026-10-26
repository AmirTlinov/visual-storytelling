import { sampleBernoulli, binomialPrefix } from '../math/binomial.js';
import type { ModelValues, StoryModel, StoryModelModule } from '../story/model.js';
export const samplingBounds = {
  percent: { min: 0, max: 100, step: 5 },
  count: { min: 1, max: 1000, step: 1 },
  seed: { min: 0, max: 0xffffffff, step: 1 },
} as const;
export const samplingKeys = ['percent', 'count', 'seed'] as const;
export function samplingInputs(value: unknown): ModelValues {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Sampling needs scalar inputs.');
  const raw = value as Record<string, unknown>,
    defaults = { percent: 50, count: 20, seed: 42 },
    result: ModelValues = {};
  if (Object.keys(raw).some((key) => !samplingKeys.includes(key as (typeof samplingKeys)[number])))
    throw new Error('Unknown sampling input.');
  for (const key of samplingKeys) {
    const number = Object.hasOwn(raw, key) ? raw[key] : defaults[key],
      bounds = samplingBounds[key];
    if (
      typeof number !== 'number' ||
      !Number.isFinite(number) ||
      number < bounds.min ||
      number > bounds.max ||
      (key !== 'percent' && !Number.isInteger(number))
    )
      throw new Error(`Sampling ${key} is outside the prepared bounds.`);
    result[key] = number;
  }
  return result;
}
const from = (values: Record<string, unknown>) =>
  samplingInputs(Object.fromEntries(samplingKeys.map((key) => [key, values[key]])));
const state = (values: ModelValues, phase: number, model?: StoryModel) => {
  const inputs = samplingInputs(values),
    sample = sampleBernoulli(
      Number(inputs.percent) / 100,
      Number(inputs.count),
      Number(inputs.seed),
    );
  const presented = binomialPrefix(
    sample,
    Math.floor(Math.min(1, Math.max(0, phase)) * sample.count),
  );
  return { ...inputs, phase, sample, presented, sources: model?.resources ?? [] };
};
export const samplingModel: StoryModelModule = {
  validateInputs: samplingInputs,
  state: (inputs, model) => state(inputs, 0, model),
  staticState: (inputs, model) => state(inputs, 2, model),
  experimentState: (inputs, authored, model) => state(inputs, Number(authored.phase), model),
  operations: {
    setup: (previous, _p, model) => state(from(previous), 0, model),
    sample: (previous, p, model) => state(from(previous), p, model),
    interval: (previous, p, model) => state(from(previous), 1 + p, model),
  },
  validateViews(views) {
    if (views.length !== 1 || views[0]!.kind !== 'binomial-sample')
      throw new Error('Show one sampling trace.');
  },
  validateSequence(operations) {
    let last = -1;
    for (const name of operations) {
      const index = ['setup', 'sample', 'interval'].indexOf(name);
      if (index <= last) throw new Error('Advance once through setup, sample and interval.');
      last = index;
    }
  },
  focusTargets: (model, views) => [
    ...views.map((view) => view.id),
    `${model.id}:estimate`,
    `${model.id}:interval`,
    `${model.id}:truth`,
  ],
};
