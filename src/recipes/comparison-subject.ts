import { comparisonViewports } from '../layout/comparison.js';
import { releaseResources } from '../lifecycle.js';
import { describeObject } from '../scene-objects.js';
import type { ModelComparison } from '../story/comparison.js';
import type { StorySubjectRecipe } from '../story/subject.js';
import type { StoryModel, StoryModelModule, StoryView, ModelState } from '../story/model.js';
import type { AuthoredBeat } from '../story/document.js';

/** Two drawing viewports share the existing shell, input history and Story. */
export function comparisonSubject(config: {
  model: StoryModelModule;
  recipe(pair: ModelComparison): StorySubjectRecipe;
  views(id: string): readonly StoryView[];
  changes: readonly string[];
  frame?: StorySubjectRecipe['frame'];
}): StorySubjectRecipe {
  const comparison = (state: ModelState) => state.comparison as ModelComparison;
  return {
    title: 'Сравниваем два опыта',
    frame: config.frame,
    resolveInput(patch, current, document, script) {
      const time = (() => {
        const chapter = document.chapters.at(-1),
          beat = chapter?.beats.at(-1);
        return beat ? script.cues[`${chapter!.id}.${beat.id}`]!.end : undefined;
      })();
      return {
        values: { ...current.values, ...patch },
        time: current.playing ? current.time : (time ?? current.time),
      };
    },
    parameters(model) {
      const pair = comparison(config.model.staticState!(model.inputs, model));
      const recipe = config.recipe(pair);
      const fields = recipe.parameters({
        ...model,
        id: pair.before.id,
        module: pair.before.module,
        inputs: pair.before.inputs,
      });
      const selected = fields.find((field) => field.key === model.inputs.comparisonChange);
      if (!selected) throw new Error('The selected comparison input needs a domain control.');
      return [
        ...fields,
        {
          key: 'comparisonChange',
          label: 'Меняем',
          type: 'select',
          value: model.inputs.comparisonChange!,
          options: config.changes.map((key) => ({
            value: key,
            label: fields.find((field) => field.key === key)!.label,
          })),
        },
        {
          ...selected,
          key: 'comparisonValue',
          label: 'Новое значение',
          value: model.inputs.comparisonValue!,
        },
        {
          key: 'comparisonCase',
          label: 'Опыт',
          type: 'select',
          value: model.inputs.comparisonCase!,
          options: [
            { value: 'before', label: 'Было' },
            { value: 'after', label: 'Стало' },
          ],
        },
      ];
    },
    create(viewport) {
      let current: ReturnType<typeof candidate> | undefined,
        signature = '';
      function candidate(model: StoryModel, state: ModelState, viewId: string) {
        const pair = comparison(state),
          recipe = config.recipe(pair),
          panels = comparisonViewports(viewport);
        const drawings: Array<{
          model: StoryModel;
          views: readonly StoryView[];
          state: ModelState;
          drawing: ReturnType<StorySubjectRecipe['create']>;
        }> = [];
        let cleanupMeaning = () => {};
        const dispose = () =>
          releaseResources(
            [
              ...drawings.toReversed().map((item) => () => item.drawing.dispose()),
              cleanupMeaning,
              () => panels.dispose(),
            ],
            'Comparison drawing disposal failed.',
          );
        try {
          panels.container.dataset.object = viewId;
          cleanupMeaning = describeObject(panels.container, {
            label: 'Два опыта с общими условиями',
            value: () => pair.changes,
            interactive: false,
          });
          panels.layout('before', true);
          for (const slot of panels.cases) {
            const item = pair[slot.side],
              scoped = { ...model, id: item.id, module: item.module, inputs: item.inputs };
            drawings.push({
              model: scoped,
              views: config.views(item.id),
              state: item.state,
              drawing: recipe.create(slot.viewport, scoped),
            });
          }
          return {
            panels,
            drawings,
            dispose,
          };
        } catch (error) {
          releaseResources(
            [
              () => {
                throw error;
              },
              dispose,
            ],
            'Comparison preparation failed.',
          );
          throw error;
        }
      }
      function validate(next: ReturnType<typeof candidate>, beats: readonly AuthoredBeat[]) {
        for (const item of next.drawings)
          item.drawing.validate(
            item.model,
            item.views,
            item.model.inputs,
            beats.map((beat) => ({ ...beat, operation: undefined })),
          );
      }
      return {
        validate(model, views, values, beats) {
          const state = config.model.staticState!(values, model),
            next = candidate(model, state, views[0]!.id);
          try {
            validate(next, beats);
          } catch (error) {
            releaseResources(
              [
                () => {
                  throw error;
                },
                next.dispose,
              ],
              'Comparison validation failed.',
            );
            throw error;
          }
          next.dispose();
        },
        render(model, views, state, beat) {
          const layout = viewport.layout;
          const key = JSON.stringify([
            model.id,
            views,
            comparison(state),
            layout.width,
            layout.height,
            layout.scale,
            layout.displayWidth,
          ]);
          const next =
            current && signature === key ? current : candidate(model, state, views[0]!.id);
          const reveal = Number(state.comparisonProgress) > 0;
          const active = reveal && state.comparisonCase === 'after' ? 'after' : 'before';
          try {
            if (next !== current) validate(next, beat ? [beat] : []);
            for (const [index, item] of next.drawings.entries())
              item.drawing.render(
                item.model,
                item.views,
                item.state,
                index === (active === 'after' ? 1 : 0) && beat
                  ? { ...beat, operation: undefined }
                  : undefined,
              );
            next.panels.layout(active, reveal);
          } catch (error) {
            if (next !== current)
              releaseResources(
                [
                  () => {
                    throw error;
                  },
                  next.dispose,
                ],
                'Comparison rendering failed.',
              );
            throw error;
          }
          if (next !== current) {
            const previous = current;
            next.panels.show();
            current = next;
            signature = key;
            // The new pair is committed. Cleanup failure cannot roll back that publication.
            try {
              previous?.dispose();
            } catch (error) {
              console.warn('Previous comparison drawing cleanup failed.', error);
            }
          }
        },
        snapshot: (state) => state,
        dispose() {
          const previous = current;
          current = undefined;
          previous?.dispose();
        },
      };
    },
  };
}
