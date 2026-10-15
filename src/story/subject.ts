import type { SceneMount, SceneOptions } from '../scene.js';
import type { Script, Frame } from './cues.js';
import type { StoryModel, StoryView, ModelValues, ModelState } from './model.js';
import type { AuthoredBeat, StoryDocument } from './document.js';

/** A prepared drawing provides subject facts; the shell and Story retain all interaction state. */
export interface StorySubjectDrawing {
  /** Prepare concealed resources; the previously accepted drawing must stay intact. */
  prepare?(
    model: StoryModel,
    views: readonly StoryView[],
    state: ModelState,
    beat: AuthoredBeat | undefined,
    moment: { readonly frame: Frame; readonly mode: 'story' | 'explore' } | undefined,
    signal: AbortSignal,
  ): void | Promise<void>;
  ready?(signal?: AbortSignal): void | Promise<unknown>;
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
    moment?: { readonly frame: Frame; readonly mode: 'story' | 'explore' },
  ): void;
  snapshot(state: ModelState): unknown;
  dispose(): void;
}
export interface StorySubjectRecipe {
  title: string;
  /** An intrinsic drawing aperture; shared navigation remains outside a stage frame. */
  frame?: SceneOptions['frame'];
  parameters(model: StoryModel): NonNullable<SceneOptions['parameters']>;
  resolveInput?(
    patch: Readonly<Partial<ModelValues>>,
    current: { readonly values: ModelValues; readonly time: number; readonly playing: boolean },
    document: StoryDocument,
    script: Script,
    intent: 'input' | 'restore',
  ): { values: Partial<ModelValues>; time?: number };
  /** Project narrative fields while retaining the viewer's chosen subject inputs. */
  resolveTime?(values: Readonly<ModelValues>, authored: ModelState, frame: Frame): ModelValues;
  controls?: readonly string[];
  create(viewport: DrawingViewport, model: StoryModel): StorySubjectDrawing;
}
/** Drawings receive geometry; SceneShell alone owns input, history and playback. */
export type DrawingViewport = Pick<SceneMount, 'stage' | 'layout'> &
  Partial<Pick<SceneMount, 'input' | 'attachView'>>;
export type StorySubjects = Readonly<Record<string, StorySubjectRecipe>>;
