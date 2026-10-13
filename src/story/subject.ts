import type { SceneMount, SceneOptions } from '../scene.js';
import type { Script } from './cues.js';
import type { StoryModel, StoryView, ModelValues, ModelState } from './model.js';
import type { AuthoredBeat, StoryDocument } from './document.js';

/** A prepared drawing provides subject facts; the shell and Story retain all interaction state. */
export interface StorySubjectDrawing {
  validate(
    model: StoryModel,
    views: readonly StoryView[],
    values: ModelValues,
    beats: readonly AuthoredBeat[],
  ): void;
  render(
    model: StoryModel,
    views: readonly StoryView[],
    state: ModelState,
    beat?: AuthoredBeat,
  ): void;
  snapshot(state: ModelState): unknown;
  dispose(): void;
}
export interface StorySubjectRecipe {
  title: string;
  parameters(model: StoryModel): NonNullable<SceneOptions['parameters']>;
  inputTime?(document: StoryDocument, script: Script): number | undefined;
  create(shell: SceneMount, model: StoryModel): StorySubjectDrawing;
}
export type StorySubjects = Readonly<Record<string, StorySubjectRecipe>>;
