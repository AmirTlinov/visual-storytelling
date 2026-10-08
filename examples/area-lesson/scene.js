import { IllustratedStory, inkChapter } from '@visual-storytelling/core/story';
import { predictionPrompt } from '@visual-storytelling/core/controls';
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
      }),
      create: (view) =>
        areaDiagram(view, {
          revealResult: (frame) => chapter.id !== 'prediction' || Boolean(frame.values.checked),
        }),
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
  const notes = globalThis.document.createElement('div');
  lesson.shell.stage.closest('.ve-frame').after(notes);
  const prompt = predictionPrompt(notes, {
    choices: [6, 12, 24].map((value) => ({ value, label: `${value} см²` })),
    runLabel: 'Удвоить ширину и проверить',
    onChoose(guess) {
      lesson.story.explore({
        ...lesson.story.requested.values,
        chapter: 'prediction',
        sceneTime: 1,
        width: 3,
        height: 2,
        guess,
        checked: false,
      });
    },
    onRun() {
      const values = lesson.story.requested.values;
      if (Number(values.guess) < 0 || values.checked) return;
      lesson.story.explore({ ...values, width: 6, height: 2, checked: true });
    },
  });
  const next = globalThis.document.createElement('button');
  next.type = 'button';
  next.textContent = 'Попробовать свои стороны';
  next.onclick = () =>
    lesson.story.explore({ ...lesson.story.requested.values, chapter: 'experiment', sceneTime: 1 });
  notes.append(next);
  const details = globalThis.document.createElement('details');
  details.innerHTML =
    '<summary>Почему здесь работает умножение?</summary><p>Длина ряда определяет число единичных квадратов в нём. Высота определяет число одинаковых рядов. Умножение считает их все: площадь = число квадратов в ряду × число рядов. При другой единице длины изменится и единица площади.</p>';
  notes.append(details);
  const update = () => {
    const values = lesson.story.presented?.values;
    if (!values) return;
    const trial = values.chapter === 'prediction';
    prompt.element.hidden = !trial;
    next.hidden = !trial || !values.checked;
    details.hidden = trial && !values.checked;
    prompt.render({
      question: 'До опыта: 3 × 2 см. Удвоим только ширину. Какой станет площадь?',
      guess: Number(values.guess) < 0 ? null : values.guess,
      checked: Boolean(values.checked),
      feedback: `${Number(values.guess) === Number(values.width) * Number(values.height) ? 'Верно.' : `Ваш прогноз: ${values.guess} см².`} Получилось ${Number(values.width) * Number(values.height)} см²: два ряда по шесть квадратов. Ширина выросла вдвое, высота осталась прежней, площадь тоже удвоилась.`,
    });
  };
  const unsubscribe = lesson.story.subscribe(update);
  update();
  lesson.shell.onDispose(() => {
    unsubscribe();
    prompt.dispose();
    notes.remove();
  });
  return lesson;
})();
