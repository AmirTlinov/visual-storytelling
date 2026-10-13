import { DIVISION_MAX_COUNT, DIVISION_MAX_DIVISOR } from './division-capacity.js';
import { surface } from '../ink/surface.js';
import { divisionState } from '../math/division.js';
import { divisionDiagram, type DivisionFocusTarget } from './division.js';
import type { StorySubjectRecipe } from '../story/subject.js';
let serial = 0;
export const divisionSubject: StorySubjectRecipe = {
  title: 'Остаток от деления',
  inputTime(document, script) {
    for (const chapter of document.chapters)
      for (const beat of chapter.beats)
        if (beat.operation?.name === 'group') return script.cues[`${chapter.id}.${beat.id}`]!.end;
  },
  parameters: (model) => [
    {
      key: 'count',
      label: 'Предметов',
      type: 'stepper',
      value: model.inputs.count!,
      min: 0,
      max: DIVISION_MAX_COUNT,
      step: 1,
    },
    {
      key: 'divisor',
      label: 'В группе',
      type: 'stepper',
      value: model.inputs.divisor!,
      min: 1,
      max: DIVISION_MAX_DIVISOR,
      step: 1,
    },
  ],
  create(shell, model) {
    const drawing = surface(shell.stage, {
      id: `division-${++serial}`,
      title: 'Деление на полные группы и остаток',
      description: 'Меняйте количество предметов или размер группы и проверяйте результат.',
      width: shell.layout.width,
      height: shell.layout.height,
      grid: false,
    });
    const diagram = divisionDiagram(drawing, model.id);
    let latestModel = model;
    const snapshot = (state: Record<string, unknown>) => ({
      ...divisionState(Number(state.count), Number(state.divisor), { id: latestModel.id }),
      parts: state.parts,
    });
    const options = (views: Parameters<ReturnType<StorySubjectRecipe['create']>['render']>[1]) => ({
      width: shell.layout.width,
      height: shell.layout.height,
      scale: shell.layout.scale,
      showEquation: views.some((view) => view.kind === 'equation'),
      viewIds: {
        groups: views.find((view) => view.kind === 'groups')!.id,
        equation: views.find((view) => view.kind === 'equation')?.id,
      },
    });
    return {
      validate(model, views, values, beats) {
        const state = divisionState(Number(values.count), Number(values.divisor), { id: model.id });
        for (const text of new Set([undefined, ...beats.map((beat) => beat.text)]))
          diagram.validate(state, { ...options(views), progress: 1, text });
      },
      render(model, views, state, beat) {
        latestModel = model;
        const layout = shell.layout;
        drawing.resize(layout.width, layout.height, false);
        const focus = beat?.focus?.map(
          (id): DivisionFocusTarget =>
            id === `${model.id}:remainder`
              ? 'remainder'
              : (views.find((view) => view.id === id)!.kind as DivisionFocusTarget),
        );
        diagram.render(snapshot(state), {
          ...options(views),
          progress: Number(state.progress),
          text: beat?.text,
          focus: focus ?? 'all',
        });
      },
      snapshot,
      dispose() {
        diagram.dispose();
        drawing.dispose();
      },
    };
  },
};
