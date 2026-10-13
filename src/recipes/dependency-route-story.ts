import type { AuthoredChapter, StoryDocument, StoryView } from '../story/document-schema.js';
import { instructionalRouteModel } from './dependency-route-model.js';
import type { ModelValues } from '../story/model.js';

export interface DependencyRouteStoryInput {
  recipe?: 'dependency-route';
  id?: string;
  title?: string;
  inputs: ModelValues;
  views?: readonly StoryView[];
  chapters?: readonly AuthoredChapter[];
}

/** The compact experience and ordinary JS authoring share one document and one trace. */
export function dependencyRouteStory(input: DependencyRouteStoryInput): StoryDocument {
  const extra = Object.keys(input).find(
    (key) => !['recipe', 'id', 'title', 'inputs', 'views', 'chapters'].includes(key),
  );
  if (extra) throw new Error(`dependency-route.${extra}: unknown field.`);
  const id = input.id ?? 'route';
  const views = input.views ?? [
    { id: 'network', kind: 'dependency-network', model: id },
    { id: 'status', kind: 'order-status', model: id },
  ];
  let chapterId = 'journey';
  while ([id, ...views.map((view) => view.id)].includes(chapterId)) chapterId += '.story';
  return {
    version: 2,
    ...(input.title !== undefined && { title: input.title }),
    models: [
      {
        id,
        module: 'dependency-route',
        inputs: instructionalRouteModel.validateInputs(input.inputs),
      },
    ],
    views,
    chapters: input.chapters ?? [
      {
        id: chapterId,
        title: input.title ?? 'Куда попадёт заказ?',
        beats: [
          {
            id: 'start',
            action: 'Послать один заказ',
            operation: { model: id, name: 'reset' },
            seconds: 1,
          },
          {
            id: 'follow',
            action: 'Проследить выбранный маршрут',
            operation: { model: id, name: 'trace' },
            seconds: 4,
          },
          {
            id: 'result',
            action: 'Проверить, куда дошёл заказ',
            operation: { model: id, name: 'finish' },
            seconds: 1,
          },
        ],
      },
    ],
  };
}
