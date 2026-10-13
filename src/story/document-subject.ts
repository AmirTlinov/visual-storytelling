import { prepareStoryDocument } from './document-model.js';
import { storyModels } from '../recipes/story-models.js';
import { storySubjects } from '../recipes/story-subjects.js';
import type { StoryModules } from './model.js';
import type { StorySubjects } from './subject.js';
import type { Script } from './cues.js';

/** Check the prepared surface's capabilities before writing or mounting a project. */
export function prepareIllustratedDocument(
  source: unknown,
  options: { modules?: StoryModules; subjects?: StorySubjects } = {},
  aligned?: Script,
) {
  const prepared = prepareStoryDocument(source, options, aligned);
  const model = prepared.document.models[0];
  if (prepared.document.models.length !== 1 || !model)
    throw new Error('Provide chapter factories for a composed or custom subject.');
  const recipe = { ...storySubjects, ...options.subjects }[model.module];
  if (!recipe) throw new Error(`Model ${model.module} needs a drawing factory.`);
  return {
    ...prepared,
    model,
    recipe,
    module: { ...storyModels, ...options.modules }[model.module]!,
  };
}
