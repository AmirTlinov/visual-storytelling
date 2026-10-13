import type { StoryDocument, AuthoredChapter } from '../story/document-schema.js';
import type { ModelValues } from '../story/model.js';
import { leverComparisonModel, routeComparisonModel } from './comparison-owners.js';
export interface ComparisonStoryInput {
  recipe?: 'comparison';
  kind: 'lever' | 'dependency-route';
  inputs: ModelValues;
  changes: ModelValues;
  id?: string;
  title?: string;
  chapters?: readonly AuthoredChapter[];
}
export function comparisonStory(input: ComparisonStoryInput): StoryDocument {
  if (
    Object.keys(input).some(
      (key) => !['recipe', 'kind', 'inputs', 'changes', 'id', 'title', 'chapters'].includes(key),
    )
  )
    throw new Error('Unknown comparison document field.');
  if (!['lever', 'dependency-route'].includes(input.kind))
    throw new Error('Select the lever or dependency-route comparison.');
  if (
    !input.changes ||
    typeof input.changes !== 'object' ||
    Array.isArray(input.changes) ||
    Object.keys(input.changes).length !== 1
  )
    throw new Error('A focused comparison changes one selected condition.');
  const [change] = Object.keys(input.changes),
    module = input.kind === 'lever' ? 'lever-comparison' : 'route-comparison',
    owner = input.kind === 'lever' ? leverComparisonModel : routeComparisonModel,
    id = input.id ?? input.kind;
  const viewId = id === 'comparison' ? 'comparison.view' : 'comparison';
  let chapterId = 'compare';
  while ([id, viewId].includes(chapterId)) chapterId += '.story';
  return {
    version: 2,
    ...(input.title !== undefined && { title: input.title }),
    models: [
      {
        id,
        module,
        inputs: owner.validateInputs({
          ...input.inputs,
          comparisonChange: change!,
          comparisonValue: input.changes[change!]!,
        }),
      },
    ],
    views: [{ id: viewId, kind: 'comparison', model: id }],
    chapters: input.chapters ?? [
      {
        id: chapterId,
        title:
          input.title ??
          (input.kind === 'lever' ? 'Почему рычаг поворачивается?' : 'Поможет ли другой резерв?'),
        beats: [
          { id: 'before', operation: { model: id, name: 'baseline' }, seconds: 2 },
          { id: 'change', operation: { model: id, name: 'change' }, seconds: 2 },
          { id: 'compare', operation: { model: id, name: 'compare' }, seconds: 2 },
        ],
      },
    ],
  };
}
