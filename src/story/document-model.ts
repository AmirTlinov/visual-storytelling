import { storyModelOwners } from '../recipes/story-models.js';
import { documentChapter, documentScript } from './document-timing.js';
import {
  validateStoryDocument,
  type StoryDocument,
  type AuthoredBeat,
  type StoryDocumentOptions,
} from './document-schema.js';
import { composeChapters } from './composition-plan.js';
import type { Frame, Script } from './cues.js';
import type { ModelValues, ModelState, StoryModules } from './model.js';
import { modelInputValues } from './model.js';
import { cueSheet } from './cues.js';

/** Publication and mounting prepare the same normalized candidate and its optional clock. */
export function prepareStoryDocument(
  source: unknown,
  options: StoryDocumentOptions = {},
  aligned?: Script,
) {
  const document = validateStoryDocument(source, options);
  const script = documentTimeline(document, aligned, options);
  if (script) {
    const sheet = cueSheet(script);
    const boundaries = new Set([
      0,
      ...Object.values(script.cues).flatMap((cue) => [cue.start, cue.end]),
    ]);
    for (const time of boundaries) documentModelsAt(document, sheet.at(time), {}, options.modules);
  }
  return { document, script };
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
  options: { mode?: 'story' | 'explore' } = {},
) {
  const owners = storyModelOwners(modules);
  const models: Record<string, ModelState> = Object.fromEntries(
    document.models.map((model) => {
      const owner = owners[model.module]!;
      const values = owner.validateInputs(
        options.mode === 'explore' ? model.inputs : (inputs[model.id] ?? model.inputs),
      );
      return [
        model.id,
        !frame && owner.staticState ? owner.staticState(values, model) : owner.state(values, model),
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
            model,
          );
          modelInputValues(model, models[modelId]!, owners[model.module]!);
        }
        for (const view of document.views) frame.target(id, view.id);
      }
  if (options.mode === 'explore')
    for (const model of document.models) {
      const owner = owners[model.module]!;
      const values = owner.validateInputs(inputs[model.id] ?? model.inputs);
      models[model.id] = owner.experimentState
        ? owner.experimentState(values, models[model.id]!, model)
        : owner.staticState
          ? owner.staticState(values, model)
          : owner.state(values, model);
    }
  return { models, beat };
}
