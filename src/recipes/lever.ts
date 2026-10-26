import { surface } from '../ink/surface.js';
import { leverArtwork, type LeverCalibration } from './lever-artwork.js';
import { leverInteraction } from './lever-interaction.js';
import { leverModel, leverInputKeys, type LeverModelState } from './lever-model.js';
import type { StorySubjectRecipe } from '../story/subject.js';
let serial = 0;

/** The existing model, shell history and Story player own every accepted trial. */
export function leverSubject({
  maxForce = 1,
  maxArm = 100,
}: Partial<LeverCalibration> = {}): StorySubjectRecipe {
  if (![maxForce, maxArm].every((value) => Number.isFinite(value) && value > 0))
    throw new Error('Lever calibration must be positive.');
  const maximumArm = Math.min(100, Math.floor(maxArm));
  return {
    title: 'Как уравновесить рычаг?',
    frame: { width: 1280, height: 960, scope: 'stage' },
    resolveInput(patch, current, _document, _script, intent) {
      const values = { ...current.values, ...patch };
      if (Math.max(Number(values.leftArm), Number(values.rightArm)) > maximumArm)
        throw new Error(`Lever arms must not exceed ${maximumArm}cm.`);
      return {
        values,
        time: intent === 'input' ? 0 : current.time,
        playback: intent === 'input' ? 'pause' : undefined,
      };
    },
    parameters: (model) =>
      leverInputKeys.map((key) => ({
        key,
        label: `${key.startsWith('left') ? 'Слева' : 'Справа'}: ${key.endsWith('Force') ? 'вес, Н' : 'расстояние от оси, см'}`,
        type: 'stepper',
        value: model.inputs[key]!,
        min: 0,
        max: key.endsWith('Arm') ? maximumArm : 100,
        step: 1,
      })),
    create(viewport) {
      const view = surface(viewport.stage, {
        id: `lever-${++serial}`,
        width: viewport.layout.width,
        height: viewport.layout.height,
        title: 'Рычаг с двумя закреплёнными грузами',
        description:
          'Каждое изменение задаёт новый запуск горизонтального невесомого рычага из покоя. Вес направлен вертикально вниз. Упоры ограничивают поворот до18градусов.',
        grid: false,
      });
      view.element.setAttribute('role', 'group');
      let current: ReturnType<typeof leverArtwork> | undefined,
        key = '',
        validated = '';
      const interaction = leverInteraction(view.element, viewport, (side) =>
        current?.grips.get(side),
      );
      const geometry = () => [viewport.layout.width, viewport.layout.height, viewport.layout.scale];
      return {
        validate(model, views, values, beats) {
          if (Math.max(Number(values.leftArm), Number(values.rightArm)) > maxArm)
            throw new Error('Lever distance exceeds the shared drawing calibration.');
          const texts = [...new Set([undefined, ...beats.map((beat) => beat.text)])];
          const signature = JSON.stringify([model.id, views, texts, geometry()]);
          if (signature === validated) return;
          const state = leverModel.staticState!(values, model) as LeverModelState;
          for (const text of texts) {
            const candidate = leverArtwork(
              view,
              viewport,
              model.id,
              views[0]!.id,
              state,
              {
                maxForce,
                maxArm,
              },
              maximumArm,
            );
            try {
              candidate.render(state, text);
            } finally {
              candidate.dispose();
            }
          }
          validated = signature;
        },
        render(model, views, state, beat) {
          const signature = JSON.stringify([model.id, views, geometry()]);
          view.resize(viewport.layout.width, viewport.layout.height, false);
          const next =
            signature === key && current
              ? current
              : leverArtwork(
                  view,
                  viewport,
                  model.id,
                  views[0]!.id,
                  state as LeverModelState,
                  {
                    maxForce,
                    maxArm,
                  },
                  maximumArm,
                );
          try {
            next.render(state as LeverModelState, beat?.text);
          } catch (error) {
            if (next !== current) next.dispose();
            throw error;
          }
          if (next !== current) {
            const previous = current;
            next.canvas.removeAttribute('visibility');
            current = next;
            key = signature;
            previous?.dispose();
          }
        },
        snapshot: (state) => state,
        dispose() {
          interaction.dispose();
          current?.dispose();
          current = undefined;
          view.dispose();
        },
      };
    },
  };
}
