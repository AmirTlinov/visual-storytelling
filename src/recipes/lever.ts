import { surface } from '../ink/surface.js';
import { svg } from '../ink/dom.js';
import { object } from '../ink/object.js';
import { lettering } from '../ink/lettering.js';
import { pen } from '../ink/pen.js';
import { vector } from './vector.js';
import { rational, rationalNumber, rationalText, multiplyRational } from '../math/rational.js';
import { leverModel, leverInputKeys } from './lever-model.js';
import type { LeverState } from '../math/lever.js';
import type { StorySubjectRecipe } from '../story/subject.js';
let serial = 0;
/** One shared force/arm calibration applies to both comparison cases. */
export function leverSubject({
  maxForce = 200,
  maxArm = 100,
}: { maxForce?: number; maxArm?: number } = {}): StorySubjectRecipe {
  if (![maxForce, maxArm].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Lever calibration must be positive.');
  return {
    title: 'Почему рычаг поворачивается?',
    parameters: (model) =>
      leverInputKeys.map((key) => ({
        key,
        label: `${key.startsWith('left') ? 'Слева' : 'Справа'}: ${key.endsWith('Force') ? 'сила, Н' : 'плечо, см'}`,
        type: 'stepper',
        value: model.inputs[key]!,
        min: 0,
        max: 100,
        step: 1,
      })),
    create(viewport) {
      const view = surface(viewport.stage, {
        id: `lever-${++serial}`,
        width: viewport.layout.width,
        height: viewport.layout.height,
        title: 'Моменты сил относительно шарнира',
        description:
          'Горизонтальный невесомый рычаг; силы направлены вниз. Угол из момента не определяется.',
        grid: false,
      });
      let current: ReturnType<typeof picture> | undefined,
        key = '';
      function picture(modelId: string, viewId: string, state: LeverState, text?: string) {
        const { width, height, scale } = viewport.layout;
        const canvas = svg('svg', {
          width,
          height,
          viewBox: `0 0 ${width} ${height}`,
          visibility: 'hidden',
        });
        view.layer.append(canvas);
        const root = object(canvas, viewId),
          drawingPen = pen(canvas),
          cleanups: Array<() => void> = [() => canvas.remove(), root.dispose];
        const font = Math.max(16, Math.min(22, (width * scale) / 24)) / scale,
          cx = width / 2,
          y = height * 0.42,
          armScale = (width * 0.34) / maxArm,
          forceScale = (height * 0.22) / maxForce;
        const drawing = { ...view, element: canvas, layer: root.content, pen: drawingPen };
        function label(
          parent: SVGElement,
          value: string,
          x: number,
          y: number,
          anchor: 'start' | 'middle' | 'end' = 'middle',
        ) {
          const item = lettering(parent, value, { x, y, size: font, anchor });
          cleanups.push(item.dispose);
          if (item.width > width * 0.94)
            throw new Error('Lever text needs one short readable line.');
          return item;
        }
        try {
          const rod = drawingPen.line(
            root.content,
            `${modelId}:rod`,
            [width * 0.1, y],
            [width * 0.9, y],
            { width: 1.4 / scale },
          );
          cleanups.push(rod.dispose);
          const pivot = object(root.content, `${modelId}:pivot`);
          pivot.describe({
            label: 'Требуемая вертикальная реакция шарнира',
            value: () => state.requiredVerticalReaction,
            unit: 'Н',
            provenance: () => ({
              kind: 'required-vertical-reaction',
              staticallyCompatible: state.equilibrium,
            }),
            interactive: false,
          });
          const fulcrum = drawingPen.path(
            pivot.content,
            `${modelId}:pivot:shape`,
            `M${cx} ${y} l${-9 / scale} ${8 / scale} h${18 / scale} Z`,
            { width: 1 / scale },
          );
          cleanups.push(fulcrum.dispose, pivot.dispose);
          const coincident = state.left.arm.numerator === 0 && state.right.arm.numerator === 0;
          for (const side of ['left', 'right'] as const) {
            const load = state[side],
              cm = multiplyRational(load.arm, rational(100)),
              distance = rationalNumber(cm) * armScale;
            const x = cx + (side === 'left' ? -distance : distance),
              pigment = side === 'left' ? 'blue' : 'green';
            const mark = object(root.content, `${modelId}:${side}`, pigment);
            mark.describe({
              label: `${side === 'left' ? 'Левая' : 'Правая'} сила и плечо`,
              value: () => load.moment,
              unit: 'Н·м',
              inputs: () => [`${modelId}:${side}Force`, `${modelId}:${side}Arm`],
              provenance: () => ({ force: load.force, arm: load.arm }),
              interactive: false,
            });
            cleanups.push(mark.dispose);
            const arrow = vector(
              { ...drawing, layer: mark.content },
              `${modelId}:${side}Force`,
              pigment,
              1.2 / scale,
            );
            const length = rationalNumber(load.force) * forceScale;
            arrow.set([x, y - length], [x, y]);
            if (coincident) arrow.show(false);
            arrow.describe({
              label: 'Сила вниз',
              value: () => load.force,
              unit: 'Н',
              interactive: false,
            });
            cleanups.push(arrow.dispose);
            // At coincident zero arms, separate the annotations while retaining the same application point.
            const labelX = distance < font ? cx + (side === 'left' ? -font * 2.2 : font * 2.2) : x;
            const forceText = object(mark.content, `${modelId}:${side}Force`, pigment);
            forceText.describe({
              label: 'Сила вниз',
              value: () => load.force,
              unit: 'Н',
              interactive: false,
            });
            cleanups.push(forceText.dispose);
            label(
              forceText.content,
              `${rationalText(load.force)} Н`,
              labelX,
              y - length - font * 0.65,
            );
            const arm = object(mark.content, `${modelId}:${side}Arm`, pigment);
            arm.describe({
              label: 'Перпендикулярное плечо',
              value: () => cm,
              unit: 'см',
              provenance: () => ({ meters: load.arm }),
              interactive: false,
            });
            cleanups.push(arm.dispose);
            if (distance > 0) {
              const ruler = drawingPen.path(
                arm.content,
                `${modelId}:${side}:arm`,
                `M${cx} ${y + font * 0.65} H${x} M${cx} ${y + font * 0.45} v${font * 0.4} M${x} ${y + font * 0.45} v${font * 0.4}`,
                { width: 0.85 / scale },
              );
              cleanups.push(ruler.dispose);
            }
            label(arm.content, `${rationalText(cm)} см`, labelX, y + font * 1.6);
          }
          if (coincident) {
            const combined = vector(drawing, `${modelId}:combinedForce`, 'ink', 1.2 / scale);
            const length = rationalNumber(state.requiredVerticalReaction) * forceScale;
            combined.set([cx, y - length], [cx, y]);
            combined.describe({
              label: 'Сумма двух сил в шарнире',
              value: () => state.requiredVerticalReaction,
              unit: 'Н',
              inputs: () => [`${modelId}:leftForce`, `${modelId}:rightForce`],
              interactive: false,
            });
            cleanups.push(combined.dispose);
          }
          const moment = object(root.content, `${modelId}:moment`);
          moment.describe({
            label: 'Суммарный момент',
            value: () => state.netMoment,
            unit: 'Н·м',
            inputs: () => [`${modelId}:left`, `${modelId}:right`],
            interactive: false,
          });
          cleanups.push(moment.dispose);
          label(
            moment.content,
            `${rationalText(state.left.moment)} − ${rationalText(state.right.moment)} = ${rationalText(state.netMoment)} Н·м`,
            cx,
            height * 0.79,
          );
          label(
            root.content,
            text ??
              (state.equilibrium
                ? 'Моменты уравновешены.'
                : state.direction === 'left-down'
                  ? 'Слева момент больше.'
                  : 'Справа момент больше.'),
            cx,
            height * 0.96,
          );
          return {
            canvas,
            dispose() {
              for (const cleanup of cleanups.reverse()) cleanup();
            },
          };
        } catch (error) {
          for (const cleanup of cleanups.reverse()) cleanup();
          throw error;
        }
      }
      return {
        validate(model, views, values, beats) {
          const state = leverModel.staticState!(values, model) as unknown as LeverState;
          for (const text of new Set([undefined, ...beats.map((beat) => beat.text)]))
            picture(model.id, views[0]!.id, state, text).dispose();
        },
        render(model, views, state, beat) {
          const signature = JSON.stringify([
            model.id,
            views,
            state,
            beat?.text,
            viewport.layout.width,
            viewport.layout.height,
            viewport.layout.scale,
          ]);
          view.resize(viewport.layout.width, viewport.layout.height, false);
          if (signature === key) return;
          const next = picture(model.id, views[0]!.id, state as unknown as LeverState, beat?.text),
            previous = current;
          next.canvas.removeAttribute('visibility');
          current = next;
          key = signature;
          previous?.dispose();
        },
        snapshot: (state) => state,
        dispose() {
          current?.dispose();
          current = undefined;
          view.dispose();
        },
      };
    },
  };
}
