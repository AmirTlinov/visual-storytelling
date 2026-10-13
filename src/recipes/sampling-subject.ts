import { surface } from '../ink/surface.js';
import { svg } from '../ink/dom.js';
import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import { pen } from '../ink/pen.js';
import { releaseResources } from '../lifecycle.js';
import { plot } from './plot.js';
import { samplingModel, samplingKeys, samplingBounds } from './sampling-model.js';
import type { StorySubjectRecipe } from '../story/subject.js';
import type { ModelState } from '../story/model.js';
import type { sampleBernoulli, binomialPrefix } from '../math/binomial.js';
let serial = 0;
const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
export const samplingSubject: StorySubjectRecipe = {
  title: 'Насколько точна доля успехов?',
  inputTime(document, script) {
    const chapter = document.chapters.at(-1),
      beat = chapter?.beats.at(-1);
    return beat ? script.cues[`${chapter!.id}.${beat.id}`]!.end : undefined;
  },
  parameters: (model) =>
    samplingKeys.map((key) => ({
      key,
      label: key === 'percent' ? 'p в модели, %' : key === 'count' ? 'Наблюдений, n' : 'Seed',
      type: 'stepper',
      value: model.inputs[key]!,
      ...samplingBounds[key],
    })),
  create(viewport) {
    const view = surface(viewport.stage, {
      id: `sample-${++serial}`,
      width: viewport.layout.width,
      height: viewport.layout.height,
      title: 'Накопленная доля успехов и интервал',
      description:
        'Синтетические испытания Бернулли; p известна модели. Seed задаёт воспроизводимую выборку.',
      grid: false,
    });
    let current: ReturnType<typeof picture> | undefined,
      key = '';
    function picture(modelId: string, viewId: string, state: ModelState, text?: string) {
      const { width, height, scale } = viewport.layout,
        size = Math.max(25, 16 / scale),
        sample = state.sample as ReturnType<typeof sampleBernoulli>,
        presented = state.presented as ReturnType<typeof binomialPrefix>;
      const estimateY = height - size * (text ? 3 : 1.75),
        intervalY = height - size * (text ? 1.75 : 0.5);
      const canvas = svg('svg', {
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
      });
      view.layer.append(canvas);
      const root = object(canvas, viewId),
        drawPen = pen(canvas),
        cleanups = [() => canvas.remove(), root.dispose];
      const drawing = { ...view, element: canvas, layer: root.content, pen: drawPen };
      const label = (parent: SVGElement, value: string, x: number, y: number) => {
        const ink = lettering(parent, value, { x, y, size, anchor: 'middle' });
        cleanups.push(ink.dispose);
        if (ink.width > width * 0.94) throw new Error('Keep one short sampling line.');
        return ink;
      };
      try {
        const chart = plot(drawing, `${modelId}:sample-plot`, {
          x: width * 0.15,
          y: size * 2.1,
          width: width * 0.73,
          height: Math.max(size * 2.5, height - size * (text ? 7.9 : 6.65)),
          xDomain: [0, sample.count],
          yDomain: [0, 1],
          xTicks: [
            { value: 0, label: '0' },
            { value: sample.count, label: `n=${sample.count}` },
          ],
          yTicks: [
            { value: 0, label: '0%' },
            { value: 1, label: '100%' },
          ],
          tickSize: size,
          labelSize: size,
        });
        cleanups.push(chart.dispose);
        const truth = object(root.content, `${modelId}:truth`, 'muted');
        cleanups.push(truth.dispose);
        truth.describe({
          label: 'Заданная вероятность в модели',
          value: () => sample.probability,
          unit: '1',
          provenance: () => ({ sources: state.sources, kind: 'simulation' }),
          interactive: false,
        });
        const a = chart.point(0, sample.probability),
          b = chart.point(sample.count, sample.probability);
        const reference = drawPen.line(truth.content, `${modelId}:truth-line`, a, b, {
          width: 0.9 / scale,
        });
        reference.element.style.opacity = '.45';
        cleanups.push(reference.dispose);
        label(truth.content, `В модели: ${percent(sample.probability)}`, width * 0.58, size * 1.1);
        const estimate = object(root.content, `${modelId}:estimate`, 'blue');
        cleanups.push(estimate.dispose);
        estimate.describe({
          label: 'Оценка по показанным наблюдениям',
          value: () => presented.estimate,
          unit: '1',
          provenance: () => ({
            count: presented.count,
            successes: presented.successes,
            seed: sample.seed,
            sources: state.sources,
          }),
          interactive: false,
        });
        if (presented.count) {
          const curve = chart.trace(
            'estimate',
            sample.draws.map((draw) => [draw.index + 1, draw.estimate]),
            'blue',
          );
          curve.showAhead(false);
          curve.at(presented.count, presented.estimate!);
          label(
            estimate.content,
            `${presented.successes}/${presented.count} = ${percent(presented.estimate!)}`,
            width * 0.5,
            estimateY,
          );
        } else label(estimate.content, 'Ещё нет наблюдений.', width * 0.5, estimateY);
        const interval = object(root.content, `${modelId}:interval`, 'orange');
        cleanups.push(interval.dispose);
        interval.describe({
          label: '95% интервал Уилсона',
          value: () => (Number(state.phase) > 1 ? presented.interval : null),
          unit: '1',
          inputs: () => [`${modelId}:estimate`],
          provenance: () => ({ method: 'wilson', confidence: 0.95, sources: state.sources }),
          interactive: false,
        });
        if (Number(state.phase) > 1 && presented.interval) {
          const ci = presented.interval,
            x = sample.count,
            low = chart.point(x, ci.low),
            high = chart.point(x, ci.high),
            cap = 5 / scale;
          const band = drawPen.path(
            interval.content,
            `${modelId}:interval-band`,
            `M${low[0]} ${low[1]}V${high[1]} M${low[0] - cap} ${low[1]}h${2 * cap} M${high[0] - cap} ${high[1]}h${2 * cap}`,
            { width: 1.4 / scale },
          );
          cleanups.push(band.dispose);
          label(
            interval.content,
            `95%: ${percent(ci.low)} – ${percent(ci.high)}`,
            width * 0.5,
            intervalY,
          );
        }
        if (text) label(root.content, text, width * 0.5, height - size * 0.5);
        chart.layout();
        // Layout measures connected, visible ink. This synchronous preparation cannot paint
        // before publication; hiding it earlier suppresses the plot owner's axis placement.
        canvas.setAttribute('visibility', 'hidden');
        return {
          canvas,
          dispose: () =>
            releaseResources(cleanups.toReversed(), 'Sampling drawing disposal failed.'),
        };
      } catch (error) {
        releaseResources(
          [
            () => {
              throw error;
            },
            ...cleanups.toReversed(),
          ],
          'Sampling preparation failed.',
        );
        throw error;
      }
    }
    return {
      validate(model, views, values, beats) {
        const state = samplingModel.staticState!(values, model);
        for (const text of new Set([undefined, ...beats.map((beat) => beat.text)]))
          for (const phase of [0, 2])
            picture(model.id, views[0]!.id, { ...state, phase }, text).dispose();
      },
      render(model, views, state, beat) {
        const nextKey = JSON.stringify([model.id, views, state, beat?.text, viewport.layout]);
        if (nextKey === key) return;
        const next = picture(model.id, views[0]!.id, state, beat?.text),
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
