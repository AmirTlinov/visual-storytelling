import { prepareIllustratedDocument } from './document-subject.js';
import type { IllustratedStoryOptions } from './illustrated.js';
import type { StoryModel, StoryModelModule, ModelValues } from './model.js';
import type { StoryDocument } from './document-schema.js';
import type { Script } from './cues.js';
import type { StoryMoment } from './story.js';
import type { documentModelsAt } from './document-model.js';
import type { StorySubjectDrawing, DrawingViewport } from './subject.js';

/** The mounted subject owns candidate validation and the accepted viewer inputs. */
export function illustratedPreparation({
  model,
  module,
  options,
  aligned,
  shell,
  drawing,
  document,
  presented,
}: {
  model: StoryModel;
  module: StoryModelModule;
  options: IllustratedStoryOptions;
  aligned?: Script;
  shell: DrawingViewport & { readonly parameters: ModelValues };
  drawing: StorySubjectDrawing;
  document: () => StoryDocument;
  presented: () => StoryMoment<ModelValues, ReturnType<typeof documentModelsAt>> | undefined;
}) {
  let checkedDrawing: string | undefined;
  let modelChecks: ReturnType<typeof prepareIllustratedDocument>['checks'];
  const drawingChecks = { evaluated: 0, reused: 0 };
  function prepare(source: unknown, provisional = false, authoredInputs: readonly string[] = []) {
    const currentDocument = document();
    const { document: next, script, checks } = prepareIllustratedDocument(source, options, aligned);
    const nextModel = next.models[0];
    if (
      next.models.length !== 1 ||
      !nextModel ||
      nextModel.module !== model.module ||
      (!provisional && nextModel.id !== currentDocument.models[0]!.id)
    )
      throw new Error('Retain the prepared subject identity while editing this document.');
    if (
      !Array.isArray(authoredInputs) ||
      authoredInputs.some((key) => !Object.hasOwn(model.inputs, key))
    )
      throw new Error('authoredInputs: choose registered model inputs.');
    const previous = presented();
    const current = previous?.values ?? shell.parameters;
    const values = module.validateInputs(
      Object.fromEntries(
        Object.entries(nextModel.inputs).map(([key, value]) => [
          key,
          !authoredInputs.includes(key) && value === currentDocument.models[0]!.inputs[key]
            ? current[key]
            : value,
        ]),
      ),
    );
    const beats = next.chapters.flatMap((chapter) => chapter.beats);
    const key = JSON.stringify({
      model: nextModel,
      views: next.views,
      values,
      beats: beats.map(
        ({ say: _say, speech: _speech, seconds: _seconds, timing: _timing, ...drawing }) => drawing,
      ),
      layout: shell.layout,
    });
    const opaque =
      Object.keys(options.modules ?? {}).length > 0 ||
      Object.keys(options.subjects ?? {}).length > 0;
    if (opaque || key !== checkedDrawing) {
      drawing.validate(nextModel, next.views, values, beats);
      checkedDrawing = opaque ? undefined : key;
      drawingChecks.evaluated++;
    } else drawingChecks.reused++;
    modelChecks = checks;
    return { next, values, previous, script };
  }
  return {
    prepare,
    get checks() {
      return { model: structuredClone(modelChecks), drawing: { ...drawingChecks } };
    },
  };
}
