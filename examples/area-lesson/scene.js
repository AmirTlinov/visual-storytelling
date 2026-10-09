import { lettering, object } from '@visual-storytelling/core';
import { IllustratedStory, inkChapter } from '@visual-storytelling/core/story';
import { inkButton } from '@visual-storytelling/core/controls';
import { areaDiagram } from '@visual-storytelling/core/recipes';
import document from './story.json';
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  const root = globalThis.document.getElementById('story');
  const audio = root.querySelector('audio') ?? globalThis.document.querySelector('audio');
  const drawing = (chapter) =>
    inkChapter({
      ...chapter,
      controls: [],
      grid: false,
      valuesAt: (frame) => {
        const doubled = chapter.id === 'prediction' && frame.beat?.id === 'result';
        const bothSides = chapter.id === 'experiment' && frame.beat?.id === 'compare';
        return {
          width: chapter.id === 'unit' ? 1 : doubled || bothSides ? 6 : 3,
          height: chapter.id === 'unit' ? 1 : bothSides ? 4 : 2,
          guess: -1,
          checked: doubled,
        };
      },
      create(view) {
        const trial = chapter.id === 'prediction',
          experiment = chapter.id === 'experiment';
        const diagram = areaDiagram(view, {
          maxColumns: chapter.id === 'unit' ? 1 : chapter.id === 'rows' ? 3 : 6,
          maxRows: chapter.id === 'unit' ? 1 : experiment ? 5 : 2,
          compareColumns: trial ? 3 : undefined,
          visibleUnits(frame) {
            const count = Number(frame.values.width) * Number(frame.values.height);
            if (chapter.id !== 'rows' || frame.mode === 'explore') return count;
            if (frame.beat?.id === 'repeat')
              return 3 + Math.min(3, Math.floor(frame.beat.progress * 4));
            return frame.beat?.id === 'rule' ? count : 3;
          },
          showRows: () => chapter.id === 'rows',
          revealResult: (frame) =>
            trial
              ? Boolean(frame.values.checked)
              : chapter.id !== 'rows' || frame.mode === 'explore' || frame.beat?.id === 'rule',
        });
        const overlay = object(view.layer, 'area-actions');
        let latest,
          focusResult = false;
        const change = (values) => latest?.input?.(values);
        const buttons = [];
        const button = (id, text, options) => {
          const control = inkButton(view, id, text, options);
          overlay.content.append(control.element);
          buttons.push(control);
          return control;
        };
        const forecast = lettering(overlay.content, '', { size: 30 });
        forecast.element.dataset.areaForecast = '';
        forecast.element.style.display = trial ? '' : 'none';
        const outcome = lettering(overlay.content, '', { size: 26 });
        outcome.element.dataset.areaOutcome = '';
        outcome.element.style.display = 'none';
        outcome.element.setAttribute('role', 'status');
        outcome.element.setAttribute('aria-live', 'polite');
        outcome.element.setAttribute('tabindex', '-1');
        const choices = trial
          ? [6, 12, 24].map((value) =>
              button(`guess-${value}`, `${value} см²`, {
                label: `${value} см²`,
                width: 96,
                height: 52,
                size: 27,
                pigment: 'orange',
                onPress: () => change({ width: 3, height: 2, guess: value, checked: false }),
              }),
            )
          : [];
        const run = trial
          ? button('double-width', 'Ширина × 2', {
              label: 'Удвоить ширину и проверить',
              width: 232,
              height: 52,
              size: 28,
              pigment: 'orange',
              onPress() {
                if (Number(latest.values.guess) >= 0 && !latest.values.checked) {
                  focusResult = true;
                  change({ width: 6, height: 2, checked: true });
                }
              },
            })
          : undefined;
        const next = experiment
          ? undefined
          : button(
              'area-next',
              chapter.id === 'unit'
                ? 'Собрать два ряда →'
                : chapter.id === 'rows'
                  ? 'Удвоить ширину →'
                  : 'Свои стороны →',
              {
                label:
                  chapter.id === 'unit'
                    ? 'Сложить квадраты в ряды'
                    : chapter.id === 'rows'
                      ? 'Проверить удвоение ширины'
                      : 'Попробовать свои стороны',
                width: 292,
                height: 52,
                size: 27,
                onPress() {
                  change({
                    chapter:
                      chapter.id === 'unit'
                        ? 'rows'
                        : chapter.id === 'rows'
                          ? 'prediction'
                          : 'experiment',
                    sceneTime: 1,
                    ...(trial ? { width: 6, height: 2 } : { width: 3, height: 2 }),
                    guess: -1,
                    checked: false,
                  });
                },
              },
            );
        const dimensions = experiment
          ? ['width', 'height'].flatMap((key) =>
              [-1, 1].map((delta) => ({
                key,
                delta,
                control: button(`${key}-${delta}`, delta < 0 ? '−' : '+', {
                  label: `${delta < 0 ? 'Уменьшить' : 'Увеличить'} ${key === 'width' ? 'ширину' : 'высоту'}`,
                  width: 50,
                  height: 48,
                  size: 31,
                  onPress: () => change({ [key]: Number(latest.values[key]) + delta }),
                }),
              })),
            )
          : [];
        return {
          render(frame, viewport) {
            latest = frame;
            diagram.render(frame, { ...viewport, height: viewport.height - 76 });
            const model = diagram.snapshot(),
              { x, y, width, height } = model.bounds,
              unit = model.pixelsPerCm,
              checked = Boolean(frame.values.checked);
            // Measurements, predicted area and the action occupy the same drawing coordinates.
            if (trial) {
              const futureX = x + 4.5 * unit;
              forecast.text(checked ? '' : 'Вся площадь?');
              forecast.element.style.display = checked ? 'none' : '';
              outcome.element.style.display =
                checked && Number(frame.values.guess) >= 0 ? '' : 'none';
              forecast.at(futureX, y + height / 2 - 40);
              choices.forEach((choice, index) => {
                choice.at(futureX + (index - 1) * 110, y + height / 2 + 18);
                choice.update({
                  pressed: Number(frame.values.guess) === [6, 12, 24][index],
                  disabled: checked,
                });
                choice.element.style.display = checked ? 'none' : '';
              });
              run.at(futureX, viewport.height - 42);
              run.update({ disabled: Number(frame.values.guess) < 0 || checked });
              run.element.style.display = checked ? 'none' : '';
              outcome.text(
                checked
                  ? `Прогноз: ${frame.values.guess} см² ${Number(frame.values.guess) === model.area ? '✓' : '→ 12 см²'}`
                  : '',
              );
              outcome.at(x + 1.5 * unit, viewport.height - 22);
              outcome.element.setAttribute(
                'aria-label',
                checked
                  ? `Ваш прогноз: ${frame.values.guess} см². Получилось ${model.area} см²: ${3 * model.rows} + ${3 * model.rows}.`
                  : 'Прогноз ещё не проверен',
              );
            }
            if (next) {
              next.at(trial ? x + 4.5 * unit : viewport.width / 2, viewport.height - 42);
              next.element.style.display = trial && !checked ? 'none' : '';
            }
            dimensions.forEach(({ key, delta, control }) => {
              const value = Number(frame.values[key]);
              control.update({
                disabled: delta < 0 ? value <= 1 : value >= (key === 'width' ? 6 : 5),
              });
              control.at(
                key === 'width' ? x + width / 2 + delta * 98 : x - 66,
                key === 'width' ? y + height + 39 : y + height / 2 + delta * 59,
              );
            });
            if (focusResult && checked) {
              focusResult = false;
              outcome.element.focus();
            }
            // Retain every control node so repeated actions preserve keyboard focus.
          },
          snapshot: () => diagram.snapshot(),
          dispose() {
            diagram.dispose();
            buttons.forEach((control) => control.dispose());
            forecast.dispose();
            outcome.dispose();
            overlay.dispose();
          },
        };
      },
    });
  const lesson = await IllustratedStory.mount(root, {
    document,
    audio,
    parameters: [
      { key: 'width', label: 'Ширина, см', value: 3, min: 1, max: 6, step: 1 },
      { key: 'height', label: 'Высота, см', value: 2, min: 1, max: 5, step: 1 },
      { key: 'guess', label: 'Прогноз, см²', value: -1, min: -1, max: 30, step: 1 },
      { key: 'checked', label: 'Опыт выполнен', type: 'toggle', value: false },
    ],
    chapters: Object.fromEntries(document.chapters.map((chapter) => [chapter.id, drawing])),
  });
  // The chapter selector and player own navigation; dimensions are drawn beside the rectangle.
  const update = () => lesson.shell.showParameters([]);
  const unsubscribe = lesson.story.subscribe(update);
  update();
  lesson.shell.onDispose(unsubscribe);
  return lesson;
})();
