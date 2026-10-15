import type { AuthoredChapter, StoryDocument, StoryView } from '../story/document-schema.js';
import type { ModelValues } from '../story/model.js';
import { fractionInputs } from './fractions-model.js';
export interface FractionsStoryInput {
  recipe?: 'fractions';
  id?: string;
  title?: string;
  inputs: ModelValues;
  views?: readonly StoryView[];
  chapters?: readonly AuthoredChapter[];
}
export function fractionsStory(input: FractionsStoryInput): StoryDocument {
  if (
    Object.keys(input).some(
      (key) => !['recipe', 'id', 'title', 'inputs', 'views', 'chapters'].includes(key),
    )
  )
    throw new Error('Unknown fractions document field.');
  const id = input.id === undefined ? 'fractions' : input.id;
  const views =
    input.views === undefined
      ? [
          { id: id === 'pieces' ? 'pieces.view' : 'pieces', kind: 'fraction-parts', model: id },
          {
            id: id === 'equation' ? 'equation.view' : 'equation',
            kind: 'fraction-equation',
            model: id,
          },
        ]
      : input.views;
  let chapter = 'together';
  while ([id, ...(Array.isArray(views) ? views.map((view) => view?.id) : [])].includes(chapter))
    chapter += '.story';
  return {
    version: 2,
    ...(input.title !== undefined && { title: input.title }),
    models: [{ id, module: 'fractions', inputs: fractionInputs(input.inputs) }],
    views,
    chapters:
      input.chapters === undefined
        ? [
            {
              id: chapter,
              title: 'Собираем части одного целого',
              beats: [
                { id: 'align', operation: { model: id, name: 'align' }, seconds: 1 },
                { id: 'partition', operation: { model: id, name: 'partition' }, seconds: 2 },
                { id: 'collect', operation: { model: id, name: 'collect' }, seconds: 2 },
                { id: 'result', operation: { model: id, name: 'finish' }, seconds: 1 },
              ],
            },
          ]
        : input.chapters,
  };
}
