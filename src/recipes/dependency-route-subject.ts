import { surface } from '../ink/surface.js';
import type { Point } from '../ink/pen.js';
import { dependencyRouteDiagram } from './dependency-route.js';
import {
  dependencyRouteModel,
  dependencyObservation,
  instructionalDependencyGraph,
  type DependencyGraph,
  type DependencyTrace,
} from './dependency-route-model.js';
import type { StorySubjectRecipe } from '../story/subject.js';
import type { ModelState } from '../story/model.js';

export const instructionalDependencyPositions: Readonly<Record<string, Point>> = {
  shop: [0.12, 0.34],
  gateway: [0.37, 0.28],
  backup: [0.37, 0.4],
  provider: [0.64, 0.28],
  independent: [0.64, 0.4],
  bank: [0.88, 0.34],
};
let serial = 0;
export function dependencyRouteSubject(
  graph: DependencyGraph,
  positions: Readonly<Record<string, Point>>,
): StorySubjectRecipe {
  const modelOwner = dependencyRouteModel(graph);
  return {
    title: 'Куда попадёт заказ?',
    resolveInput(patch, current, document, script) {
      const time = (() => {
        const last = document.chapters.at(-1)?.beats.at(-1);
        return last ? script.cues[`${document.chapters.at(-1)!.id}.${last.id}`]!.end : undefined;
      })();
      return {
        values: { ...current.values, ...patch },
        time: current.playing ? current.time : (time ?? current.time),
      };
    },
    parameters: (model) => [
      { key: 'orderId', label: 'Заказ', type: 'text', value: model.inputs.orderId! },
      {
        key: 'reserve',
        label: 'Резервный путь',
        type: 'select',
        value: model.inputs.reserve!,
        options: [
          { value: 'none', label: 'Без резерва' },
          { value: 'shared', label: 'Общий провайдер' },
          { value: 'independent', label: 'Независимый провайдер' },
        ],
      },
      ...graph.nodes.map((item) => ({
        key: `disabled-${item.id}`,
        label: `Отказ: ${item.label}`,
        type: 'toggle' as const,
        value: model.inputs[`disabled-${item.id}`]!,
      })),
    ],
    create(shell) {
      const drawing = surface(shell.stage, {
        id: `route-${++serial}`,
        title: 'Маршрут одного заказа',
        description: 'Учебная сеть: попробуйте отказ и сравните общий и независимый резерв.',
        width: shell.layout.width,
        height: shell.layout.height,
        grid: false,
      });
      const diagram = dependencyRouteDiagram(drawing);
      const options = (
        views: Parameters<ReturnType<StorySubjectRecipe['create']>['render']>[1],
      ) => ({
        width: shell.layout.width,
        height: shell.layout.height,
        scale: shell.layout.scale,
        positions,
        networkId: views.find((view) => view.kind === 'dependency-network')!.id,
        statusId: views.find((view) => view.kind === 'order-status')?.id,
      });
      const trace = (state: ModelState) => state.trace as DependencyTrace;
      return {
        validate(model, views, values, beats) {
          let state = modelOwner.staticState!(values);
          diagram.validate(graph, trace(state), {
            ...options(views),
            modelId: model.id,
            progress: 1,
            present: state.present !== false,
          });
          for (const beat of beats) {
            if (beat.operation) state = modelOwner.operations[beat.operation.name]!(state, 1);
            diagram.validate(graph, trace(state), {
              ...options(views),
              modelId: model.id,
              progress: 1,
              text: beat.text,
            });
          }
        },
        render(model, views, state, beat) {
          drawing.resize(shell.layout.width, shell.layout.height, false);
          diagram.render(graph, trace(state), {
            ...options(views),
            modelId: model.id,
            progress: Number(state.progress),
            present: state.present !== false,
            text: beat?.text,
          });
        },
        snapshot(state) {
          return {
            ...trace(state),
            progress: state.progress,
            present: state.present !== false,
            outcome: dependencyObservation(
              trace(state),
              Number(state.progress),
              state.present !== false,
            ).outcome,
            attempt: state.reserveAttempt === true ? 'reserve' : 'automatic',
          };
        },
        dispose() {
          diagram.dispose();
          drawing.dispose();
        },
      };
    },
  };
}
export const instructionalRouteSubject = dependencyRouteSubject(
  instructionalDependencyGraph,
  instructionalDependencyPositions,
);
