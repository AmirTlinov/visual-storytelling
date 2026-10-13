import { surface } from '../ink/surface.js';
import { fractionsDiagram } from './fractions.js';
import {
  fractionState,
  fractionInputs,
  fractionDenominators,
  type FractionState,
} from './fractions-model.js';
import type { StorySubjectRecipe } from '../story/subject.js';
import type { ModelState } from '../story/model.js';
let serial = 0;
const inputs = (state: ModelState) =>
  fractionInputs(
    Object.fromEntries(
      ['leftNumerator', 'leftDenominator', 'rightNumerator', 'rightDenominator', 'action'].map(
        (key) => [key, state[key]],
      ),
    ),
  );
export const fractionsSubject: StorySubjectRecipe = {
  title: 'Собираем части одного целого',
  inputTime(document, script) {
    const chapter = document.chapters.at(-1),
      beat = chapter?.beats.at(-1);
    return beat ? script.cues[`${chapter!.id}.${beat.id}`]!.end : undefined;
  },
  parameters: (model) => [
    ...(['left', 'right'] as const).flatMap((side, index) => [
      {
        key: `${side}Numerator`,
        label: `${index === 0 ? 'Первая' : 'Вторая'}: числитель`,
        type: 'stepper' as const,
        value: model.inputs[`${side}Numerator`]!,
        min: 0,
        max: 12,
        step: 1,
      },
      {
        key: `${side}Denominator`,
        label: `${index === 0 ? 'Первая' : 'Вторая'}: знаменатель`,
        type: 'select' as const,
        value: model.inputs[`${side}Denominator`]!,
        options: fractionDenominators.map((value) => ({ value, label: String(value) })),
      },
    ]),
    {
      key: 'action',
      label: 'Первую часть',
      type: 'select',
      value: model.inputs.action!,
      options: [
        { value: 'move', label: 'Перенести' },
        { value: 'copy', label: 'Скопировать' },
      ],
    },
  ],
  create(shell) {
    const view = surface(shell.stage, {
      id: `fractions-${++serial}`,
      width: shell.layout.width,
      height: shell.layout.height,
      grid: false,
      title: 'Части одной измеряемой величины',
      description:
        'Обе доли используют одинаковое целое. Цвет и происхождение сохраняются при переносе.',
    });
    const diagram = fractionsDiagram(view);
    const options = (views: Parameters<ReturnType<StorySubjectRecipe['create']>['render']>[1]) => ({
      width: shell.layout.width,
      height: shell.layout.height,
      scale: shell.layout.scale,
      viewId: views.find((view) => view.kind === 'fraction-parts')!.id,
      equationId: views.find((view) => view.kind === 'fraction-equation')?.id,
    });
    return {
      validate(candidateModel, views, values, beats) {
        for (const progress of [0, 0.5, 1, 1.5, 2])
          for (const text of new Set([undefined, ...beats.map((beat) => beat.text)]))
            diagram.validate(fractionState(values, progress, { id: candidateModel.id }), values, {
              ...options(views),
              modelId: candidateModel.id,
              text,
            });
      },
      render(candidateModel, views, state, beat) {
        view.resize(shell.layout.width, shell.layout.height, false);
        diagram.render(state as unknown as FractionState, inputs(state), {
          ...options(views),
          modelId: candidateModel.id,
          text: beat?.text,
        });
      },
      snapshot: (state) => state,
      dispose() {
        diagram.dispose();
        view.dispose();
      },
    };
  },
};
