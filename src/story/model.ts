import type { ControlValue } from '../controls/fields.js';

export type ModelValues = Record<string, ControlValue>;
export interface StoryModel {
  id: string;
  /** Registered ordinary JavaScript module; the document contains no executable expressions. */
  module: string;
  inputs: ModelValues;
}
export interface StoryView {
  id: string;
  kind: string;
  model: string;
}
/** Subject validation and pure operations belong to the model's ordinary JS owner. */
export interface StoryModelModule {
  validateInputs(value: unknown): ModelValues;
  state(inputs: ModelValues): ModelValues;
  staticState?(inputs: ModelValues): ModelValues;
  operations: Readonly<Record<string, (state: ModelValues, progress: number) => ModelValues>>;
  validateViews(views: readonly StoryView[]): void;
  validateSequence?(operations: readonly string[]): void;
  focusTargets(model: StoryModel, views: readonly StoryView[]): readonly string[];
}
export type StoryModules = Readonly<Record<string, StoryModelModule>>;
