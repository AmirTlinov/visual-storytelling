import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import { paragraph } from '../ink/paragraph.js';
import { svg } from '../ink/dom.js';
import { pen, type Point } from '../ink/pen.js';
import type { Surface } from '../ink/surface.js';
import { fractionsMotion } from './fractions-motion.js';
import { drawingCandidate } from './drawing-candidate.js';
import { releaseResources } from '../lifecycle.js';
import { formula } from './formula.js';
import { rationalNumber, rationalText } from '../math/rational.js';
import { fractionInputs, type FractionState } from './fractions-model.js';
import type { ModelValues } from '../story/model.js';

/** The same calibrated whole fits every row. Geometry moves the model's existing parts. */
export function fractionsDiagram(view: Surface) {
  let current: ReturnType<typeof prepare> | undefined,
    signature = '',
    disposed = false;
  const candidate = drawingCandidate<ReturnType<typeof prepare>>();
  const drawingKey = (
    state: FractionState,
    inputs: ModelValues,
    options: Parameters<typeof prepare>[2],
  ) =>
    JSON.stringify([
      state.parts.map((part) => [part.id, part.amount, part.container]),
      state.denominator,
      fractionInputs(inputs),
      options,
    ]);
  function prepare(
    state: FractionState,
    inputs: ModelValues,
    options: {
      width: number;
      height: number;
      scale: number;
      modelId: string;
      equationId?: string;
      viewId: string;
      text?: string;
    },
  ) {
    if (disposed) throw new Error('Fraction drawing disposed.');
    const { width, height, scale, modelId } = options;
    if (![width, height, scale].every((v) => Number.isFinite(v) && v > 0))
      throw new Error('Fractions need positive drawing dimensions.');
    const canvas = svg('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      visibility: 'hidden',
    });
    view.layer.append(canvas);
    const picture = object(canvas, options.viewId);
    const drawingPen = pen(canvas);
    const cleanups: Array<() => void> = [() => canvas.remove(), picture.dispose];
    try {
      const whole = width * 0.72,
        x = width * 0.2,
        bar = Math.min(height * 0.08, 24 / scale),
        font = Math.max(16, Math.min(23, (width * scale) / 24)) / scale;
      const rows = [height * 0.1, height * 0.29, height * 0.53, height * 0.69];
      const cell = whole / state.denominator;
      const references: Array<ReturnType<typeof object>> = [];
      for (let row = 0; row < 4; row++) {
        const reference = object(picture.content, `${modelId}:whole:${row}`, 'muted');
        const outline = drawingPen.rect(
          reference.content,
          `${modelId}:whole:${row}:outline`,
          x,
          rows[row]!,
          whole,
          bar,
          { width: 0.85 / scale },
        );
        references.push(reference);
        reference.describe({
          label: 'Одно и то же единичное целое',
          value: () => 1,
          unit: 'whole',
          provenance: () => ({ reference: 'same-unit-whole' }),
          interactive: false,
        });
        cleanups.push(reference.dispose, outline.dispose);
        if (row < 2) {
          const side = row === 0 ? 'left' : 'right';
          const root = state.roots[row]!;
          const source = object(
            picture.content,
            `${modelId}:${side}`,
            row === 0 ? 'blue' : 'green',
          );
          source.describe({
            label: 'Исходная доля',
            value: () => root.amount,
            unit: root.unit,
            inputs: () => root.inputs,
            provenance: () => root,
            interactive: false,
          });
          const label = lettering(
            source.content,
            `${inputs[`${side}Numerator`]}/${inputs[`${side}Denominator`]}`,
            { x: x - font * 0.65, y: rows[row]! + bar * 0.75, size: font, anchor: 'end' },
          );
          cleanups.push(source.dispose, label.dispose);
        }
      }
      const destinations = new Map(
        state.parts
          .filter((part) => part.container === 'result')
          .sort(
            (a, b) =>
              Number(a.origins[0]?.id === state.roots[1]?.id) -
              Number(b.origins[0]?.id === state.roots[1]?.id),
          )
          .map((part, index) => [part.id, index]),
      );
      let resultIndex = 0;
      const sourceIndices = new Map<string, number>();
      const pieces = state.parts.map((part) => {
        const side: 'left' | 'right' =
          part.origins[0]?.id === state.roots[1]?.id ? 'right' : 'left';
        const sourceRow = side === 'left' ? 0 : 1;
        const originIndex = sourceIndices.get(side) ?? 0;
        // A copy starts from its original fragment; it never consumes an extra source slot.
        const index = part.copiedFrom ? Number(part.copiedFrom.split(':').at(-1)) : originIndex;
        if (!part.copiedFrom) sourceIndices.set(side, originIndex + 1);
        const from: Point = [
          x + (state.progress === 0 ? 0 : index * cell),
          rows[sourceRow]! + (part.copiedFrom ? bar * 1.1 : 0),
        ];
        const count = state.progress === 0 ? rationalNumber(part.amount) * state.denominator : 1;
        const isResult = part.container === 'result';
        if (isResult) resultIndex = destinations.get(part.id)!;
        const target: Point = isResult
          ? [
              x + (resultIndex % state.denominator) * cell,
              rows[2 + Math.floor(resultIndex / state.denominator)]!,
            ]
          : from;
        if (isResult) resultIndex += count;
        const mark = object(picture.content, part.id, side === 'left' ? 'blue' : 'green');
        const shape = drawingPen.rect(
          mark.content,
          `${part.id}:shape`,
          0,
          0,
          whole * rationalNumber(part.amount),
          bar,
          { fill: 'marker', width: 0 },
        );
        const border = drawingPen.rect(
          mark.content,
          `${part.id}:boundary`,
          0,
          0,
          whole * rationalNumber(part.amount),
          bar,
          { width: 0.85 / scale },
        );
        mark.describe({
          label: `Часть ${rationalText(part.amount)}`,
          value: () => part.amount,
          unit: part.unit,
          inputs: () => part.inputs,
          provenance: () => ({
            ...part,
            origins: part.origins,
          }),
        });
        cleanups.push(shape.dispose, border.dispose, mark.dispose);
        return {
          mark,
          shape,
          border,
          from,
          target,
          isResult,
          side,
          partId: part.id,
          width: whole * rationalNumber(part.amount),
        };
      });
      const motion = fractionsMotion(
        state,
        pieces.map((piece) => ({
          id: piece.partId,
          from: piece.from,
          to: piece.target,
          width: piece.width,
          height: bar,
          side: piece.side,
          moving: piece.isResult,
        })),
      );
      const equation = options.equationId
        ? formula(
            picture.content,
            options.equationId,
            [
              {
                id: 'left',
                text: '',
                pigment: 'blue',
                objectId: state.roots[0]!.id,
                meaning: {
                  label: 'Первая доля',
                  value: () => state.roots[0]!.amount,
                  unit: 'whole',
                  inputs: () => state.roots[0]!.inputs,
                  provenance: () => state.roots[0],
                  interactive: false,
                },
              },
              { id: 'plus', text: '+' },
              {
                id: 'right',
                text: '',
                pigment: 'green',
                objectId: state.roots[1]!.id,
                meaning: {
                  label: 'Вторая доля',
                  value: () => state.roots[1]!.amount,
                  unit: 'whole',
                  inputs: () => state.roots[1]!.inputs,
                  provenance: () => state.roots[1],
                  interactive: false,
                },
              },
              {
                id: 'answer',
                text: '',
                meaning: {
                  label: 'Сумма двух долей',
                  value: () => state.result,
                  unit: 'whole',
                  inputs: () =>
                    state.parts
                      .filter((part) => part.container === 'result')
                      .map((part) => part.id),
                  provenance: () => ({
                    origins: state.roots.map((root) => ({ id: root.id, amount: root.amount })),
                  }),
                  interactive: false,
                },
              },
            ],
            font,
          )
        : undefined;
      if (equation) cleanups.push(equation.dispose);
      const note = paragraph(picture.content, { size: font, lineHeight: 1.2 });
      cleanups.push(note.dispose);
      return {
        canvas,
        picture,
        references,
        pieces,
        motion,
        equation,
        note,
        font,
        x,
        whole,
        bar,
        rows,
        width,
        height,
        dispose: () => cleanups.reverse().forEach((fn) => fn()),
      };
    } catch (error) {
      cleanups.reverse().forEach((fn) => fn());
      throw error;
    }
  }
  function paint(
    next: ReturnType<typeof prepare>,
    state: FractionState,
    inputs: ModelValues,
    options: Parameters<typeof prepare>[2],
  ) {
    const progress = Math.max(0, state.progress - 1);
    next.references[2]!.show(state.progress > 1);
    next.references[3]!.show(state.progress > 1 && rationalNumber(state.result) > 1);
    const frame = next.motion.sample(progress);
    for (const [index, piece] of next.pieces.entries()) {
      const shape = frame.sources[index]!;
      piece.mark.at(shape.position[0] - shape.size[0] / 2, -shape.position[1] - shape.size[1] / 2);
      piece.mark.element.dataset.partId = piece.mark.element.dataset.object;
      piece.mark.show(shape.value > 0);
      piece.border.reveal(state.progress === 0 ? 1 : Math.min(1, state.progress));
    }
    const { leftNumerator: a, leftDenominator: b, rightNumerator: c, rightDenominator: d } = inputs;
    next.equation?.substitute(
      'left',
      state.progress >= 1
        ? `${(Number(a) * state.denominator) / Number(b)}/${state.denominator}`
        : `${a}/${b}`,
    );
    next.equation?.substitute(
      'right',
      state.progress >= 1
        ? `${(Number(c) * state.denominator) / Number(d)}/${state.denominator}`
        : `${c}/${d}`,
    );
    next.equation?.substitute(
      'answer',
      state.progress === 2 ? `= ${rationalText(state.result)}` : '',
    );
    if (next.equation) {
      if (next.equation.width > options.width * 0.92)
        throw new Error('Fraction equation needs more readable space.');
      next.equation.at(options.width / 2, options.height * 0.85);
    }
    const text =
      options.text ??
      (state.progress === 2 && inputs.action === 'copy'
        ? `После копирования всего ${rationalText(state.total)}.`
        : '');
    if (
      next.note.render(text, options.width * 0.9, options.width / 2, options.height * 0.96) >
      next.font * 1.2
    )
      throw new Error('Keep the fraction annotation to one short line.');
  }
  return {
    validate(state: FractionState, inputs: ModelValues, options: Parameters<typeof prepare>[2]) {
      candidate.check(
        drawingKey(state, inputs, options),
        () => prepare(state, inputs, options),
        (next) => paint(next, state, inputs, options),
      );
    },
    render(state: FractionState, inputs: ModelValues, options: Parameters<typeof prepare>[2]) {
      const key = drawingKey(state, inputs, options);
      const next =
        signature === key && current
          ? current
          : (candidate.take(key) ?? prepare(state, inputs, options));
      try {
        paint(next, state, inputs, options);
      } catch (error) {
        if (next !== current) next.dispose();
        throw error;
      }
      if (next !== current) {
        const previous = current;
        next.canvas.removeAttribute('visibility');
        current = next;
        signature = key;
        previous?.dispose();
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const accepted = current;
      current = undefined;
      releaseResources(
        [candidate.dispose, () => accepted?.dispose()],
        'Fraction drawing release failed.',
      );
    },
  };
}
