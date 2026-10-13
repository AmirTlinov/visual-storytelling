import type { StoryDocument, AuthoredChapter, StoryView } from '../story/document-schema.js';
import { divisionModel } from './division-model.js';

export interface DivisionStoryInput {
  recipe?: 'division';
  id?: string;
  title?: string;
  inputs: { count: number; divisor: number };
  views?: readonly StoryView[];
  /** Omit for the eight-second introduction; [] creates a static experiment. */
  chapters?: readonly AuthoredChapter[];
}
/** Authoring shorthand produces the same versioned document as ordinary chapters. */
export function divisionStory(input: DivisionStoryInput): StoryDocument {
  const extra = Object.keys(input).find(
    (key) => !['recipe', 'inputs', 'title', 'id', 'views', 'chapters'].includes(key),
  );
  if (extra) throw new Error(`division.${extra}: unknown field.`);
  const model = input.id === undefined ? 'division' : input.id;
  const views =
    input.views === undefined
      ? [
          { id: model === 'groups' ? 'groups.view' : 'groups', kind: 'groups', model },
          { id: model === 'equation' ? 'equation.view' : 'equation', kind: 'equation', model },
        ]
      : input.views;
  const occupied = new Set([model, ...(Array.isArray(views) ? views.map((view) => view?.id) : [])]);
  let chapterId = 'experience';
  while (occupied.has(chapterId)) chapterId += '.story';
  return {
    version: 2,
    ...(input.title !== undefined && { title: input.title }),
    models: [{ id: model, module: 'division', inputs: divisionModel.validateInputs(input.inputs) }],
    views,
    chapters:
      input.chapters === undefined
        ? [
            {
              id: chapterId,
              title: input.title ?? 'Остаток от деления',
              beats: [
                {
                  id: 'gather',
                  action: 'Собрать предметы',
                  operation: { model, name: 'gather' },
                  seconds: 1.2,
                },
                {
                  id: 'group',
                  action: 'Разложить по полным группам',
                  operation: { model, name: 'group' },
                  seconds: 4,
                },
                {
                  id: 'remainder',
                  action: 'Сравнить остаток с размером группы',
                  operation: { model, name: 'remainder' },
                  seconds: 2.8,
                  focus: [`${model}:remainder`],
                },
              ],
            },
          ]
        : input.chapters,
  };
}
