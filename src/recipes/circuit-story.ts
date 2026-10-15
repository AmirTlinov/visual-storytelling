import { circuitModel } from './circuit-model.js';
import { defaultChapter } from './chapter-identity.js';
import type { StoryDocument, AuthoredChapter, StoryView } from '../story/document-schema.js';

export interface CircuitStoryInput {
  recipe?: 'circuit';
  id?: string;
  title?: string;
  inputs: { closed: boolean };
  views?: readonly StoryView[];
  chapters?: readonly AuthoredChapter[];
}

/** A steady, ideal closed-loop example; no resistance, brightness or propagation claim. */
export function circuitStory(input: CircuitStoryInput): StoryDocument {
  const extra = Object.keys(input).find(
    (key) => !['recipe', 'id', 'title', 'inputs', 'views', 'chapters'].includes(key),
  );
  if (extra) throw new Error(`circuit.${extra}: unknown field.`);
  const model = input.id === undefined ? 'circuit' : input.id,
    inputs = circuitModel.validateInputs(input.inputs);
  const views =
    input.views === undefined
      ? [{ id: model === 'loop' ? 'loop.view' : 'loop', kind: 'circuit', model }]
      : input.views;
  const occupied = [model, ...(Array.isArray(views) ? views.map((view) => view?.id) : [])];
  return {
    version: 2,
    ...(input.title !== undefined && { title: input.title }),
    models: [{ id: model, module: 'circuit', inputs }],
    views,
    chapters:
      input.chapters === undefined
        ? [
            defaultChapter(
              {
                id: 'experience',
                title: input.title ?? 'Почему лампа погасла?',
                beats: [
                  {
                    id: 'look',
                    seconds: 1.5,
                    text: inputs.closed ? 'Весь контур замкнут.' : 'В контуре есть разрыв.',
                  },
                  {
                    id: 'switch',
                    seconds: 2.5,
                    operation: { model, name: inputs.closed ? 'open' : 'close' },
                    text: inputs.closed
                      ? 'Разомкнём ключ: лампа погасла.'
                      : 'Замкнём ключ: лампа светится.',
                  },
                ],
              },
              occupied,
            ),
          ]
        : input.chapters,
  };
}
