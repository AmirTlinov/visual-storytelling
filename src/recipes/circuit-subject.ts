import { surface } from '../ink/surface.js';
import { circuitDiagram } from './circuit.js';
import { svg } from '../ink/dom.js';
import { pen } from '../ink/pen.js';
import type { StorySubjectRecipe } from '../story/subject.js';

let serial = 0;

/** Circuit artwork projects the existing model; the shell owns input, history and time. */
export const circuitSubject: StorySubjectRecipe = {
  title: 'Почему лампа погасла?',
  parameters: (model) => [
    { key: 'closed', label: 'Цепь замкнута', type: 'toggle', value: model.inputs.closed! },
  ],
  create(shell) {
    const view = surface(shell.stage, {
      id: `circuit-${++serial}`,
      width: shell.layout.width,
      height: shell.layout.height,
      grid: false,
      title: 'Батарея, ключ и лампа в одном контуре',
      description:
        'Идеальная цепь: лампа работает при замкнутом контуре. Движущиеся метки обозначают условное направление тока, а не скорость электронов.',
    });
    let drawing: ReturnType<typeof circuitDiagram> | undefined,
      key = '';
    const viewport = (text?: string) => ({ ...shell.layout, text });
    const owner = (modelId: string, viewId: string) => {
      const identity = JSON.stringify([modelId, viewId]);
      if (identity !== key) {
        drawing?.dispose();
        drawing = circuitDiagram(view, { modelId, viewId });
        key = identity;
      }
      return drawing!;
    };
    return {
      validate(candidate, views, _values, beats) {
        // Candidate validation uses a separate drawing so failed edits retain accepted art.
        const layer = svg('svg', {
          width: shell.layout.width,
          height: shell.layout.height,
          viewBox: `0 0 ${shell.layout.width} ${shell.layout.height}`,
          visibility: 'hidden',
          'data-presentation-pending': '',
        });
        view.layer.append(layer);
        const pending = circuitDiagram(
          { ...view, element: layer, layer, pen: pen(layer) },
          { modelId: candidate.id, viewId: views[0]!.id },
        );
        try {
          for (const text of new Set([undefined, ...beats.map((beat) => beat.text)]))
            pending.validate(viewport(text));
        } finally {
          pending.dispose();
          layer.remove();
        }
      },
      render(candidate, views, state, beat, moment) {
        view.resize(shell.layout.width, shell.layout.height, false);
        owner(candidate.id, views[0]!.id).render(
          {
            chapter: 'circuit',
            time: moment?.frame.time ?? 0,
            progress: 0,
            reduced: moment?.frame.reduced ?? true,
            mode: moment?.mode ?? 'explore',
            values: { closed: Boolean(state.closed) },
            input: (values) => shell.input?.(values),
          },
          viewport(beat?.text),
        );
      },
      snapshot: (state) => state,
      dispose() {
        drawing?.dispose();
        view.dispose();
      },
    };
  },
};
