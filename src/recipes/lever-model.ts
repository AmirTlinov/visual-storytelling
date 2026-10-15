import { leverState } from '../math/lever.js';
import { rational } from '../math/rational.js';
import { leverMotion } from '../math/lever-motion.js';
import type { ModelValues, StoryModel, StoryModelModule } from '../story/model.js';
export const leverInputKeys = ['leftForce', 'leftArm', 'rightForce', 'rightArm'] as const;
const inputsOf = (value: ModelValues) =>
  Object.fromEntries(leverInputKeys.map((key) => [key, value[key]!]));
const state = (inputs: ModelValues, model?: StoryModel, time = 0) => {
  const value = {
    ...inputs,
    id: model?.id ?? 'lever',
    ...leverState(
      { force: rational(Number(inputs.leftForce)), arm: rational(Number(inputs.leftArm), 100) },
      { force: rational(Number(inputs.rightForce)), arm: rational(Number(inputs.rightArm), 100) },
    ),
  };
  return { ...value, time, motion: leverMotion(value, time) };
};
export type LeverModelState = ReturnType<typeof state>;
export const leverModel: StoryModelModule = {
  operationTiming: 'continuous',
  validateInputs(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error('Supply forces in N and arms in cm.');
    const inputs = value as ModelValues;
    if (
      Object.keys(inputs).some(
        (key) => !leverInputKeys.includes(key as (typeof leverInputKeys)[number]),
      )
    )
      throw new Error('Unknown lever input.');
    for (const key of leverInputKeys)
      if (
        !Number.isSafeInteger(inputs[key]) ||
        Number(inputs[key]) < 0 ||
        Number(inputs[key]) > 100
      )
        throw new Error('This lever drawing uses integer loads0–100N and arms0–100cm.');
    return Object.fromEntries(leverInputKeys.map((key) => [key, inputs[key]!]));
  },
  state,
  staticState: (inputs, model) => state(inputs, model, 2),
  experimentState: (inputs, authored, model) => state(inputs, model, Number(authored.time)),
  operations: {
    release: (previous, progress, model) =>
      state(inputsOf(previous as ModelValues), model, 2 * progress),
  },
  validateSequence(operations) {
    if (operations.length > 1)
      throw new Error('A lever trial can release once. Seek to replay the same trial.');
  },
  validateViews(views) {
    if (views.length !== 1 || views[0]!.kind !== 'lever')
      throw new Error('Require one lever view.');
  },
  focusTargets: (model, views) => [
    ...views.map((view) => view.id),
    `${model.id}:left`,
    `${model.id}:right`,
  ],
};
