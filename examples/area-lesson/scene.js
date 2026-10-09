import { explanationLayout } from '@visual-storytelling/core';
import { IllustratedStory, inkChapter } from '@visual-storytelling/core/story';
import { predictionPrompt, disclosure } from '@visual-storytelling/core/controls';
import { areaDiagram } from '@visual-storytelling/core/recipes';
import document from './story.json';
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  const root = globalThis.document.getElementById('story');
  const audio = root.querySelector('audio') ?? globalThis.document.querySelector('audio');
  const drawing = (chapter) =>
    inkChapter({
      ...chapter,
      controls: chapter.id === 'experiment' ? ['width', 'height'] : [],
      valuesAt: () => ({
        width: chapter.id === 'unit' ? 1 : 3,
        height: chapter.id === 'unit' ? 1 : 2,
        guess: -1,
        checked: false,
        detail: false,
      }),
      create: (view) =>
        areaDiagram(view, {
          maxColumns: chapter.id === 'unit' ? 1 : chapter.id === 'rows' ? 3 : 6,
          maxRows: chapter.id === 'unit' ? 1 : chapter.id === 'experiment' ? 5 : 2,
          compareColumns: chapter.id === 'prediction' ? 3 : undefined,
          visibleUnits: (frame) => {
            const count = Number(frame.values.width) * Number(frame.values.height);
            if (chapter.id !== 'rows' || frame.mode === 'explore') return count;
            if (frame.beat?.id === 'repeat')
              return 3 + Math.min(3, Math.floor(frame.beat.progress * 4));
            return frame.beat?.id === 'rule' ? count : 3;
          },
          showRows: (frame) => chapter.id === 'rows' || Boolean(frame.values.detail),
          revealResult: (frame) =>
            chapter.id === 'prediction'
              ? Boolean(frame.values.checked)
              : chapter.id !== 'rows' || frame.mode === 'explore' || frame.beat?.id === 'rule',
        }),
    });
  const lesson = await IllustratedStory.mount(root, {
    document,
    audio,
    frame: { width: 600, height: 420 },
    parameters: [
      { key: 'width', label: 'Ширина, см', value: 3, min: 1, max: 6, step: 1 },
      { key: 'height', label: 'Высота, см', value: 2, min: 1, max: 5, step: 1 },
      { key: 'guess', label: 'Прогноз, см²', value: -1, min: -1, max: 30, step: 1 },
      { key: 'checked', label: 'Опыт выполнен', type: 'toggle', value: false },
      { key: 'detail', label: 'Разобрать ряды', type: 'toggle', value: false },
    ],
    chapters: Object.fromEntries(document.chapters.map((chapter) => [chapter.id, drawing])),
  });
  const frame = lesson.shell.stage.closest('.ve-frame');
  const layout = explanationLayout(root);
  frame.before(layout.element);
  layout.figure.append(frame);
  layout.controls.append(lesson.shell.fields);
  layout.footer.append(lesson.shell.actions);
  layout.notes.setAttribute('aria-label', 'От квадрата к площади');
  layout.notes.innerHTML = `
    <p class="ve-eyebrow" data-area-step></p>
    <p class="ve-reading" data-area-reading></p>
    <p data-area-cause></p>`;
  const step = layout.notes.querySelector('[data-area-step]');
  const reading = layout.notes.querySelector('[data-area-reading]');
  const cause = layout.notes.querySelector('[data-area-cause]');
  const change = (values) => lesson.shell.input(values);
  const prompt = predictionPrompt(layout.notes, {
    choices: [6, 12, 24].map((value) => ({ value, label: `${value} см²` })),
    runLabel: 'Удвоить ширину и проверить',
    onChoose: (guess) => change({ width: 3, height: 2, guess, checked: false }),
    onRun() {
      const values = lesson.story.requested.values;
      if (Number(values.guess) < 0 || values.checked) return;
      change({ width: 6, height: 2, checked: true });
    },
  });
  const details = disclosure(layout.notes, {
    label: 'Почему здесь работает умножение?',
    onChange: (detail) => change({ detail }),
  });
  details.body.innerHTML = `
    <p>Справа у каждого ряда записано число квадратов. Складываем одинаковые ряды:</p>
    <p class="ve-equation" data-area-addition></p>
    <p class="ve-note">Ширина задаёт число квадратов в ряду, высота — число рядов. Обе стороны измеряем в сантиметрах.</p>`;
  const addition = details.body.querySelector('[data-area-addition]');
  const next = globalThis.document.createElement('button');
  next.type = 'button';
  next.dataset.areaNext = '';
  next.onclick = () => {
    const { chapter, width, height } = lesson.story.requested.values;
    if (chapter === 'unit')
      change({ chapter: 'rows', sceneTime: 1, width: 3, height: 2, detail: false });
    else if (chapter === 'rows')
      change({
        chapter: 'prediction',
        sceneTime: 1,
        width: 3,
        height: 2,
        guess: -1,
        checked: false,
        detail: false,
      });
    else change({ chapter: 'experiment', sceneTime: 1, width, height, detail: false });
  };
  layout.notes.append(next);
  let currentThought;
  const update = () => {
    const values = lesson.story.presented?.values,
      model = lesson.scene.snapshot()?.content;
    if (!values || !model) return;
    const { columns, rows, area } = model,
      trial = values.chapter === 'prediction',
      checked = Boolean(values.checked),
      unit = values.chapter === 'unit';
    const thoughts = {
      unit: [
        '01 · Сначала выбираем меру',
        'Один квадрат — <mark>один см²</mark>.',
        'Его стороны — по одному сантиметру. Четыре маленькие клетки вместе образуют нашу единицу площади.',
      ],
      rows: [
        '02 · Собираем одинаковые ряды',
        model.visibleUnits < area
          ? `В первом ряду — <mark>${columns} квадрата</mark>.`
          : `<mark>${rows} ряда</mark> по ${columns} квадрата.`,
        model.visibleUnits < area
          ? 'Добавим такой же ряд. Каждый квадрат по-прежнему занимает один см².'
          : `Сложение ${model.rowUnits.join(' + ')} даёт ${area}. Умножение записывает тот же счёт короче.`,
      ],
      prediction: [
        '03 · Записываем прогноз',
        checked
          ? 'Добавили <mark>ещё такую же часть</mark>.'
          : 'Меняем <mark>только ширину</mark>.',
        checked
          ? 'Синяя часть сохранилась. Оранжевая добавила столько же квадратов.'
          : 'Начинаем с прямоугольника 3 × 2 см. Высота останется прежней.',
      ],
      experiment: [
        '04 · Проверяем свои условия',
        `${columns} × ${rows} — это <mark>${area} см²</mark>.`,
        `${rows} ${rows === 1 ? 'ряд' : rows < 5 ? 'ряда' : 'рядов'} по ${columns} ${columns === 1 ? 'квадрату' : columns < 5 ? 'квадрата' : 'квадратов'}. Меняйте стороны и следите, как меняется число единичных квадратов.`,
      ],
    };
    const [eyebrow, thought, explanation] = thoughts[values.chapter];
    if (step.textContent !== eyebrow) step.textContent = eyebrow;
    if (currentThought !== thought) {
      reading.innerHTML = thought;
      currentThought = thought;
    }
    if (cause.textContent !== explanation) cause.textContent = explanation;
    lesson.shell.showParameters(values.chapter === 'experiment' ? ['width', 'height'] : []);
    layout.controls.hidden = values.chapter !== 'experiment';
    prompt.element.hidden = !trial;
    details.element.hidden = unit || (trial && !checked);
    details.set(Boolean(values.detail));
    const equation = `${model.rowUnits.join(' + ')} = ${columns} × ${rows} = ${area} см²`;
    if (addition.textContent !== equation) addition.textContent = equation;
    next.hidden = values.chapter === 'experiment' || (trial && !checked);
    next.textContent = unit
      ? 'Сложить квадраты в ряды'
      : values.chapter === 'rows'
        ? 'Проверить удвоение ширины'
        : 'Попробовать свои стороны';
    prompt.render({
      question: checked ? 'Сравним прогноз с результатом.' : 'Удвоим ширину. Какой станет площадь?',
      guess: Number(values.guess) < 0 ? null : values.guess,
      checked,
      feedback: `${Number(values.guess) === area ? 'Верно.' : `Ваш прогноз: ${values.guess} см².`} Получилось ${area} см²: два ряда по шесть квадратов. Ширина и площадь выросли вдвое.`,
    });
  };
  const unsubscribe = lesson.story.subscribe(update);
  update();
  lesson.shell.onDispose(() => {
    unsubscribe();
    prompt.dispose();
    details.dispose();
    layout.dispose();
  });
  return lesson;
})();
