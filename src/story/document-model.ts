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
import { checkDocumentBoundaries } from './document-checks.js';

/** Publication and mounting prepare the same normalized candidate and its optional clock. */
export function prepareStoryDocument(
  source: unknown,
  options: StoryDocumentOptions = {},
  aligned?: Script,
) {
  const document = validateStoryDocument(source, options);
  const script = documentTimeline(document, aligned, options);
  const sheet = script && cueSheet(script);
  const checks = checkDocumentBoundaries(document, script, options, (time) =>
    documentModelsAt(
      document,
      time === undefined ? undefined : sheet!.at(time),
      {},
      options.modules,
    ),
  );
  return { document, script, checks };
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
  options: { mode?: 'story' | 'explore'; chapter?: string } = {},
) {
  if (options.chapter && !document.chapters.some((chapter) => chapter.id === options.chapter))
    throw new Error(`Unknown chapter: ${options.chapter}`);
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
  let activeChapter = options.chapter
    ? document.chapters.find((chapter) => chapter.id === options.chapter)
    : undefined;
  if (frame)
    for (const chapter of document.chapters) {
      for (const action of chapter.beats) {
        const id = `${chapter.id}.${action.id}`;
        if (frame.time < frame.cue(id).start) continue;
        beat = action;
        activeChapter = chapter;
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
        for (const view of document.views)
          if (!chapter.views || chapter.views.includes(view.id)) frame.target(id, view.id);
        for (const target of action.focus ?? []) frame.target(id, target);
      }
      if (chapter.id === options.chapter) break;
    }
  if (options.chapter)
    activeChapter = document.chapters.find((chapter) => chapter.id === options.chapter);
  const views = activeChapter?.views
    ? document.views.filter((view) => activeChapter!.views!.includes(view.id))
    : document.views;
  if (activeChapter || !document.chapters.length)
    for (const model of document.models) {
      const owner = owners[model.module]!,
        selected = views.filter((view) => view.model === model.id);
      if (selected.length && owner.projectViews) {
        models[model.id] = owner.projectViews(models[model.id]!, selected, model);
        modelInputValues(model, models[model.id]!, owner);
      }
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
  return { models, beat, views, chapter: activeChapter?.id, resources: document.resources ?? [] };
}

/** The named model owns acceptance; Story alone owns the playback barrier. */
export function documentCanContinue(
  document: StoryDocument,
  moment: ReturnType<typeof documentModelsAt>,
  modules: StoryModules = {},
) {
  const gate = moment.beat?.awaitInput;
  if (!gate) return true;
  const model = document.models.find((model) => model.id === gate.model)!;
  return storyModelOwners(modules)[model.module]!.canContinue!(
    moment.models[model.id]!,
    moment.beat!,
  );
}
