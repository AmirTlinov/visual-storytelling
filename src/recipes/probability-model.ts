import { normalizeLogits, probabilityRows } from '../math/probability.js';
import type { ModelValues, StoryModel, StoryModelModule } from '../story/model.js';
export const probabilityKeys = ['scoreA', 'scoreB', 'scoreC', 'temperature'] as const;
export const probabilityBounds = {
  scoreA: { min: -1000, max: 1000, step: 1 },
  scoreB: { min: -1000, max: 1000, step: 1 },
  scoreC: { min: -1000, max: 1000, step: 1 },
  temperature: { min: 0.1, max: 10, step: 0.1 },
} as const;
export function probabilityInputs(value: unknown): ModelValues {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Probability inputs need an object.');
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).some(
      (key) => !probabilityKeys.includes(key as (typeof probabilityKeys)[number]),
    )
  )
    throw new Error('Unknown probability input.');
  const defaults = { scoreA: 0, scoreB: 1, scoreC: 2, temperature: 1 },
    result: ModelValues = {};
  for (const key of probabilityKeys) {
    const value = Object.hasOwn(raw, key) ? raw[key] : defaults[key],
      bounds = probabilityBounds[key];
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < bounds.min ||
      value > bounds.max
    )
      throw new Error(`Probability ${key} is outside the prepared drawing bounds.`);
    result[key] = value;
  }
  normalizeLogits(
    [Number(result.scoreA), Number(result.scoreB), Number(result.scoreC)],
    Number(result.temperature),
  );
  return result;
}
const from = (values: Record<string, unknown>) =>
  probabilityInputs(Object.fromEntries(probabilityKeys.map((key) => [key, values[key]])));
const state = (values: ModelValues, phase: number, model?: StoryModel) => {
  const inputs = probabilityInputs(values),
    trace = normalizeLogits(
      [Number(inputs.scoreA), Number(inputs.scoreB), Number(inputs.scoreC)],
      Number(inputs.temperature),
    );
  return {
    ...inputs,
    phase,
    trace,
    rows: probabilityRows(trace, ['А', 'Б', 'В']),
    sources: model?.resources ?? [],
  };
};
export const probabilityModel: StoryModelModule = {
  validateInputs: probabilityInputs,
  state: (inputs, model) => state(inputs, 0, model),
  staticState: (inputs, model) => state(inputs, 2, model),
  experimentState: (inputs, authored, model) => state(inputs, Number(authored.phase), model),
  operations: {
    scores: (previous, _p, model) => state(from(previous), 0, model),
    weights: (previous, p, model) => state(from(previous), p, model),
    normalize: (previous, p, model) => state(from(previous), 1 + p, model),
  },
  validateViews(views) {
    if (
      views.length !== 2 ||
      !views.some((view) => view.kind === 'probability-scores') ||
      !views.some((view) => view.kind === 'probability-distribution')
    )
      throw new Error('Show scores and the derived distribution together.');
  },
  validateSequence(operations) {
    let last = -1;
    for (const name of operations) {
      const index = ['scores', 'weights', 'normalize'].indexOf(name);
      if (index <= last) throw new Error('Advance once through scores, weights and normalization.');
      last = index;
    }
  },
  focusTargets: (model, views) => [
    ...views.map((view) => view.id),
    `${model.id}:sum`,
    ...Array.from({ length: 3 }, (_, index) => `${model.id}:score:${index}`),
    ...Array.from({ length: 3 }, (_, index) => `${model.id}:probability:${index}`),
  ],
};
