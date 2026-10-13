import { storyModels } from '../recipes/story-models.js';
import { documentChapter, documentScript } from './document-timing.js';
import {
  validateStoryDocument,
  type StoryDocument,
  type AuthoredBeat,
  type StoryDocumentOptions,
} from './document-schema.js';
import { composeChapters } from './composition-plan.js';
import type { Frame, Script } from './cues.js';
import type { ModelValues, StoryModules } from './model.js';

/** Publication and mounting prepare the same normalized candidate and its optional clock. */
export function prepareStoryDocument(
  source: unknown,
  options: StoryDocumentOptions = {},
  aligned?: Script,
) {
  const document = validateStoryDocument(source, options);
  return { document, script: documentTimeline(document, aligned, options) };
}

/** Project authored chapters through the existing composition and acoustic timing owners. */
export function documentTimeline(
  document: StoryDocument,
  aligned?: Script,
  options: StoryDocumentOptions = {},
): Script | undefined {
  if (!document.chapters.length) return;
  if (aligned) return documentScript(document, aligned, options);
  return composeChapters(
    document.chapters.map(({ id }) => documentChapter(document, id, undefined, options)),
  ).script;
}

/** Absolute replay of ordinary pure model operations; seeking never accumulates mutations. */
export function documentModelsAt(
  document: StoryDocument,
  frame?: Frame,
  inputs: Readonly<Record<string, ModelValues>> = {},
  modules: StoryModules = {},
) {
  const owners = { ...storyModels, ...modules };
  const models = Object.fromEntries(
    document.models.map((model) => {
      const owner = owners[model.module]!;
      const values = owner.validateInputs(inputs[model.id] ?? model.inputs);
      return [
        model.id,
        !frame && owner.staticState ? owner.staticState(values) : owner.state(values),
      ];
    }),
  );
  let beat: AuthoredBeat | undefined;
  if (frame)
    for (const chapter of document.chapters)
      for (const action of chapter.beats) {
        const id = `${chapter.id}.${action.id}`;
        if (frame.time < frame.cue(id).start) continue;
        beat = action;
        if (action.operation) {
          const { model: modelId, name } = action.operation;
          const model = document.models.find((model) => model.id === modelId)!;
          models[modelId] = owners[model.module]!.operations[name]!(
            models[modelId]!,
            frame.reveal(id),
          );
        }
        for (const view of document.views) frame.target(id, view.id);
      }
  return { models, beat };
}
