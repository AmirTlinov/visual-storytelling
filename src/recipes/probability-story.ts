import type { AuthoredChapter, StoryDocument } from '../story/document-schema.js';
import type { StoryResource } from '../story/resources.js';
import type { ModelValues } from '../story/model.js';
import { probabilityInputs } from './probability-model.js';
import { samplingInputs } from './sampling-model.js';
export interface ProbabilityStoryInput {
  recipe: 'probability' | 'sampling';
  id?: string;
  title?: string;
  inputs: ModelValues;
  resources?: readonly StoryResource[];
  chapters?: readonly AuthoredChapter[];
}
export function probabilityStory(input: ProbabilityStoryInput): StoryDocument {
  if (
    Object.keys(input).some(
      (key) => !['recipe', 'id', 'title', 'inputs', 'resources', 'chapters'].includes(key),
    )
  )
    throw new Error('Unknown probability story field.');
  const sampling = input.recipe === 'sampling';
  if (!sampling && input.recipe !== 'probability')
    throw new Error('Select normalization or sampling.');
  const id = input.id === undefined ? input.recipe : input.id;
  const reserved = new Set([
    id,
    ...(Array.isArray(input.resources) ? input.resources.map((item) => item?.id) : []),
    ...(Array.isArray(input.chapters) ? input.chapters : []).flatMap((chapter: AuthoredChapter) => [
      chapter.id,
      ...chapter.beats.map((beat) => `${chapter.id}.${beat.id}`),
    ]),
  ]);
  const availableId = (initial: string, suffix = '.resource') => {
    let value = initial;
    while (reserved.has(value)) value += suffix;
    reserved.add(value);
    return value;
  };
  const sourceId = availableId(`${input.recipe}-source`),
    methodId = availableId(`${input.recipe}-method`);
  const defaults: readonly StoryResource[] = sampling
    ? [
        {
          id: sourceId,
          title: 'Синтетические наблюдения',
          kind: 'simulation',
          description:
            'Независимые испытания Бернулли имитируются LCG32 с заданными p и seed. Это учебная симуляция; исходные draws доступны в trace.',
          limits: [
            'Заданная p известна модели; доля успехов оценивает её по конечной выборке.',
            'Генератор воспроизводим, а не криптографичен.',
          ],
        },
        {
          id: methodId,
          title: '95% интервал Уилсона',
          kind: 'method',
          description: 'Двусторонний score interval без поправки на непрерывность.',
          url: 'https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats._result_classes.BinomTestResult.proportion_ci.html',
          limits: [
            '95% описывает приблизительную частоту покрытия при повторных независимых выборках.',
            'Интервал не задаёт вероятность того, что фиксированная p находится внутри уже вычисленных границ.',
          ],
        },
      ]
    : [
        {
          id: sourceId,
          title: 'Заданные учебные оценки',
          kind: 'simulation',
          description:
            'Три числа вводятся пользователем; они не получены из опроса или реального GPT.',
          limits: [
            'Softmax превращает относительные оценки в распределение.',
            'Доля модели не означает достоверность утверждения или частоту события.',
          ],
        },
        {
          id: methodId,
          title: 'Устойчивая нормировка',
          kind: 'method',
          description:
            'Вычитаем общий максимум перед exp, суммируем веса и делим на их сумму. Вычисления Float64; подписи округлены.',
          url: 'https://docs.scipy.org/doc/scipy/reference/generated/scipy.special.softmax.html',
          limits: ['Нулевой вес из-за численного underflow отличается от явной маски.'],
        },
      ];
  const resources: readonly StoryResource[] = [
    ...defaults,
    ...(input.resources === undefined ? [] : input.resources),
  ];
  const viewId = availableId('distribution', '.view'),
    secondId = availableId('scores', '.view');
  const operations = sampling
    ? ['setup', 'sample', 'interval']
    : ['scores', 'weights', 'normalize'];
  let chapter = 'derive';
  while (reserved.has(chapter) || operations.some((name) => reserved.has(`${chapter}.${name}`)))
    chapter += '.story';
  return {
    version: 2,
    ...(input.title !== undefined && { title: input.title }),
    resources,
    models: [
      {
        id,
        module: input.recipe,
        inputs: (sampling ? samplingInputs : probabilityInputs)(input.inputs),
        resources: resources.map((resource) => resource.id),
      },
    ],
    views: sampling
      ? [{ id: viewId, kind: 'binomial-sample', model: id }]
      : [
          { id: secondId, kind: 'probability-scores', model: id },
          { id: viewId, kind: 'probability-distribution', model: id },
        ],
    chapters:
      input.chapters === undefined
        ? [
            {
              id: chapter,
              title: sampling ? 'Насколько точна доля успехов?' : 'Как оценки становятся долями?',
              beats: operations.map((name, index) => ({
                id: name,
                operation: { model: id, name },
                seconds: index === 1 ? 3 : 1.5,
              })),
            },
          ]
        : input.chapters,
  };
}
