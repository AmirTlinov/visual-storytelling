import { surface } from '../ink/surface.js';
import { svg } from '../ink/dom.js';
import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import { pen } from '../ink/pen.js';
import { releaseResources } from '../lifecycle.js';
import { probabilityBar } from './probability-bar.js';
import { probabilityModel, probabilityKeys, probabilityBounds } from './probability-model.js';
import type { ProbabilityTrace } from '../math/probability.js';
import type { StorySubjectRecipe } from '../story/subject.js';
import type { ModelState } from '../story/model.js';
let serial = 0;
const number = (value: number) =>
  Math.abs(value) >= 10000 || (value > 0 && value < 0.001)
    ? value.toExponential(1).replace('e+', 'e')
    : Number(value.toPrecision(3)).toString();
export const probabilitySubject: StorySubjectRecipe = {
  title: 'Как оценки становятся долями?',
  inputTime(document, script) {
    const chapter = document.chapters.at(-1),
      beat = chapter?.beats.at(-1);
    return beat ? script.cues[`${chapter!.id}.${beat.id}`]!.end : undefined;
  },
  parameters: (model) =>
    probabilityKeys.map((key, index) => ({
      key,
      label: key === 'temperature' ? 'Температура' : `Оценка ${['А', 'Б', 'В'][index]}`,
      type: 'stepper',
      value: model.inputs[key]!,
      ...probabilityBounds[key],
    })),
  create(viewport) {
    const view = surface(viewport.stage, {
      id: `probability-${++serial}`,
      width: viewport.layout.width,
      height: viewport.layout.height,
      title: 'Оценки, веса и доли',
      description: 'Один вычислительный trace связывает входы, веса после сдвига и распределение.',
      grid: false,
    });
    let current: ReturnType<typeof picture> | undefined,
      key = '';
    function picture(
      modelId: string,
      views: readonly { id: string; kind: string }[],
      state: ModelState,
      text?: string,
    ) {
      const { width, height, scale } = viewport.layout,
        size = Math.max(25, 16 / scale),
        trace = state.trace as ProbabilityTrace,
        phase = Number(state.phase);
      const canvas = svg('svg', {
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        visibility: 'hidden',
      });
      view.layer.append(canvas);
      const layer = object(canvas, views.find((view) => view.kind === 'probability-scores')!.id),
        drawPen = pen(canvas),
        cleanups = [() => canvas.remove(), layer.dispose];
      const drawing = { ...view, element: canvas, layer: layer.content, pen: drawPen };
      const label = (
        parent: SVGElement,
        value: string,
        x: number,
        y: number,
        anchor: 'middle' | 'start' = 'middle',
      ) => {
        const ink = lettering(parent, value, { x, y, size, anchor });
        cleanups.push(ink.dispose);
        if (ink.width > width * 0.94) throw new Error('Keep one short probability line.');
        return ink;
      };
      const inputs = Array.from({ length: 3 }, (_, index) => `${modelId}:score:${index}`);
      try {
        label(layer.content, 'Оценка, s', width * 0.25, size * 1.2);
        if (phase > 0) label(layer.content, 'Вес', width * 0.47, size * 1.2);
        const shares = object(
          canvas,
          views.find((view) => view.kind === 'probability-distribution')!.id,
        );
        cleanups.push(shares.dispose);
        if (phase > 1) label(shares.content, 'Доля', width * 0.8, size * 1.2);
        for (let index = 0; index < 3; index++) {
          const y = size * 2.9 + index * Math.max(size * 2, (height - size * 5.5) / 3);
          label(layer.content, ['А', 'Б', 'В'][index]!, width * 0.07, y);
          const score = object(layer.content, inputs[index]!, 'blue');
          score.describe({
            label: `Оценка ${['А', 'Б', 'В'][index]}`,
            value: () => trace.scores[index],
            provenance: () => ({ sources: state.sources }),
            interactive: false,
          });
          cleanups.push(score.dispose);
          label(score.content, number(trace.scores[index]!), width * 0.25, y);
          if (phase > 0) {
            const arrow = drawPen.arrow(
              layer.content,
              `${modelId}:weight-arrow:${index}`,
              [width * 0.32, y - size * 0.3],
              [width * 0.38, y - size * 0.3],
              { width: 1 / scale },
            );
            cleanups.push(arrow.dispose);
            const weight = object(layer.content, `${modelId}:weight:${index}`, 'purple');
            weight.describe({
              label: 'Вес после сдвига',
              value: () => trace.weights[index],
              inputs: () => inputs,
              provenance: () => ({
                score: trace.scores[index],
                maximum: trace.maximum,
                temperature: trace.temperature,
              }),
              interactive: false,
            });
            cleanups.push(weight.dispose);
            label(weight.content, number(trace.weights[index]!), width * 0.47, y);
          }
          if (phase > 1) {
            const bar = probabilityBar(
              { ...drawing, layer: shares.content },
              `${modelId}:probability:${index}`,
              trace.probabilities[index]!,
              {
                x: width * 0.61,
                y: y - size * 0.8,
                width: width * 0.19,
                height: size * 0.8,
                size,
                meaning: {
                  label: `Доля ${['А', 'Б', 'В'][index]}`,
                  value: () => trace.probabilities[index],
                  unit: '1',
                  inputs: () => inputs,
                  provenance: () => ({
                    weight: trace.weights[index],
                    totalWeight: trace.totalWeight,
                    sources: state.sources,
                  }),
                  interactive: false,
                },
              },
            );
            cleanups.push(bar.dispose);
          }
        }
        const sum = object(layer.content, `${modelId}:sum`);
        sum.show(phase > 0);
        cleanups.push(sum.dispose);
        sum.describe({
          label: 'Сумма весов',
          value: () => trace.totalWeight,
          inputs: () => inputs,
          interactive: false,
        });
        if (phase > 0)
          label(
            sum.content,
            phase > 1
              ? `Доля = вес / ${number(trace.totalWeight)}`
              : `exp((s − ${number(trace.maximum)}) / ${number(trace.temperature)})`,
            width * 0.5,
            height - size * 1.6,
          );
        if (text) label(layer.content, text, width * 0.5, height - size * 0.25);
        return {
          canvas,
          dispose: () =>
            releaseResources(cleanups.toReversed(), 'Probability drawing disposal failed.'),
        };
      } catch (error) {
        releaseResources(
          [
            () => {
              throw error;
            },
            ...cleanups.toReversed(),
          ],
          'Probability preparation failed.',
        );
        throw error;
      }
    }
    return {
      validate(model, views, values, beats) {
        const state = probabilityModel.staticState!(values, model);
        for (const text of new Set([undefined, ...beats.map((beat) => beat.text)]))
          picture(model.id, views, state, text).dispose();
      },
      render(model, views, state, beat) {
        const nextKey = JSON.stringify([model.id, views, state, beat?.text, viewport.layout]);
        if (key === nextKey) return;
        const next = picture(model.id, views, state, beat?.text),
          previous = current;
        view.resize(viewport.layout.width, viewport.layout.height, false);
        next.canvas.removeAttribute('visibility');
        current = next;
        key = nextKey;
        previous?.dispose();
      },
      snapshot: (state) => state,
      dispose() {
        current?.dispose();
        view.dispose();
      },
    };
  },
};
