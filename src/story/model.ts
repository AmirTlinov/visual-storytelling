import type { ControlValue } from '../controls/fields.js';
import type { AuthoredBeat } from './document-schema.js';

export type ModelValues = Record<string, ControlValue>;
/** Computed subject data can include a trace, graph or tensor; editable controls stay scalar. */
export type ModelState = Record<string, unknown>;
export interface StoryModel {
  id: string;
  /** Registered ordinary JavaScript module; the document contains no executable expressions. */
  module: string;
  inputs: ModelValues;
  /** Source and interpretation metadata lives once in the document resources. */
  resources?: readonly string[];
}
export interface StoryView {
  id: string;
  kind: string;
  model: string;
}
/** Subject validation and pure operations belong to the model's ordinary JS owner. */
export interface StoryModelModule {
  validateInputs(value: unknown): ModelValues;
  state(inputs: ModelValues, model?: StoryModel): ModelState;
  staticState?(inputs: ModelValues, model?: StoryModel): ModelState;
  /** The authored representation projects the same computed subject before manual input. */
  projectViews?(state: ModelState, views: readonly StoryView[], model: StoryModel): ModelState;
  /** Viewer conditions remain authoritative while the authored episode supplies its visual progress. */
  experimentState?(inputs: ModelValues, authored: ModelState, model?: StoryModel): ModelState;
  operations: Readonly<
    Record<string, (state: ModelState, progress: number, model?: StoryModel) => ModelState>
  >;
  /** A checked attempt releases a declared prediction beat, including a wrong answer. */
  canContinue?(state: ModelState, beat: AuthoredBeat): boolean;
  validateViews(views: readonly StoryView[]): void;
  validateSequence?(operations: readonly string[]): void;
  focusTargets(model: StoryModel, views: readonly StoryView[]): readonly string[];
}
export type StoryModules = Readonly<Record<string, StoryModelModule>>;
export function modelInputValues(
  model: StoryModel,
  state: ModelState,
  owner: StoryModelModule,
): ModelValues {
  return owner.validateInputs(
    Object.fromEntries(Object.keys(model.inputs).map((key) => [key, state[key]])),
  );
}
