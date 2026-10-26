import { leverModel } from './lever-model.js';
import { defaultChapter } from './chapter-identity.js';
import type { ModelValues } from '../story/model.js';
import type { StoryDocument, AuthoredChapter } from '../story/document-schema.js';
import type { StoryResource } from '../story/resources.js';

export function leverResources(id: string): readonly StoryResource[] {
  return [
    {
      id: `${id}.mechanics`,
      kind: 'method',
      title: 'Идеальный рычаг с грузами',
      description:
        'Невесомая жёсткая перекладина, неподвижная ось без трения, закреплённые точечные грузы с весом F и массой F/g. Каждый опыт начинается горизонтально из покоя. I=(Fл rл²+Fп rп²)/g; Iθ″=(Fл rл−Fп rп)cosθ, g=9,81м/с². Две физические секунды показаны на часах опыта; скорость воспроизведения меняет длительность просмотра.',
      url: 'https://openstax.org/books/university-physics-volume-1/pages/10-7-newtons-second-law-for-rotation',
      limits: [
        'Расстояния указаны вдоль перекладины. При наклоне перпендикулярное плечо равно r cosθ; строка моментов относится к горизонтальному старту.',
        'Видимые упоры ограничивают угол до±18°. При ударе скорость становится нулевой. Остановка на упоре не означает равновесие грузов.',
        'Перемещение и изменение веса задают новый опыт из покоя. Модель не продолжает движение после перестановки груза.',
        'Нормированная траектория записана Rapier2D0.21.0 с шагом1/3840 и линейной интерполяцией образцов1/120. Затухание и масса стержня отсутствуют.',
      ],
    },
  ];
}

export interface LeverStoryInput {
  recipe: 'lever';
  id?: string;
  title?: string;
  inputs: ModelValues;
  chapters?: readonly AuthoredChapter[];
  resources?: readonly StoryResource[];
}
export function leverStory(input: LeverStoryInput): StoryDocument {
  if (
    Object.keys(input).some(
      (key) => !['recipe', 'id', 'title', 'inputs', 'chapters', 'resources'].includes(key),
    )
  )
    throw new Error('Unknown lever document field.');
  const id = input.id === undefined ? 'lever' : input.id;
  const viewId = id === 'lever.view' ? 'lever.view.diagram' : 'lever.view';
  const resources = [
    ...leverResources(id),
    ...(input.resources === undefined ? [] : input.resources),
  ];
  return {
    version: 2,
    ...(input.title !== undefined && { title: input.title }),
    resources,
    models: [
      {
        id,
        module: 'lever',
        inputs: leverModel.validateInputs(input.inputs),
        resources: resources.map((resource) => resource.id),
      },
    ],
    views: [{ id: viewId, kind: 'lever', model: id }],
    chapters:
      input.chapters === undefined
        ? [
            defaultChapter(
              {
                id: 'trial',
                title: 'Как уравновесить рычаг?',
                beats: [
                  { id: 'release', operation: { model: id, name: 'release' }, seconds: 6 },
                  { id: 'try', seconds: 2 },
                ],
              },
              [id, viewId, ...resources.map((resource) => resource.id)],
            ),
          ]
        : input.chapters,
  };
}
