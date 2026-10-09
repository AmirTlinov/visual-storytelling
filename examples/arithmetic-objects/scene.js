import { SceneShell, SketchControls, surface } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import './style.css';
import { lessons, lessonAt, timing } from './lesson.js';
import { addition, subtraction, multiplication, division } from './diagrams.js';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('arithmetic-objects');
  const shell = SceneShell.mount(root, { title: 'Что делает действие?', paper: false });
  const choose = SketchControls.field(
    {
      type: 'choice',
      label: 'Действие',
      value: 'add',
      options: lessons.map(({ id, label }) => ({ value: id, label })),
    },
    (id) => {
      root.scene.pause();
      root.scene.seek(lessons.find((lesson) => lesson.id === id).start);
    },
  );
  choose.element.classList.add('operation-choice');
  const heading = document.createElement('h2');
  const question = document.createElement('p');
  const equation = document.createElement('p');
  const conclusion = document.createElement('p');
  heading.className = 'sr-only';
  question.className = 'sr-only';
  equation.className = 'operation-equation';
  conclusion.className = 'sr-only';
  conclusion.setAttribute('role', 'status');
  shell.stage.before(choose.element, heading, question, equation);
  shell.stage.after(conclusion);
  const drawing = surface(shell.stage, {
    id: 'arithmetic-drawing',
    width: 720,
    height: 450,
    grid: false,
    title: 'Предметы показывают арифметическое действие',
    description:
      'Шарики собираются вместе, монеты передаются получателю, клетки повторяются, пироги делятся поровну. Выберите действие и нажмите воспроизведение. Ползунок позволяет рассмотреть любой момент.',
  });
  const diagrams = {
    add: addition(drawing),
    subtract: subtraction(drawing),
    multiply: multiplication(drawing),
    divide: division(drawing),
  };
  let current;
  shell.attachStory({
    script: timing,
    stateAt: (frame) => ({ operation: lessonAt(frame.time).id }),
    render({ operation }, frame) {
      const lesson = lessons.find((item) => item.id === operation);
      const narrow = shell.stage.clientWidth < 600;
      const width = narrow ? 360 : 720;
      const height = diagrams[operation].height(narrow);
      const progress = frame.reduced
        ? Number(frame.finished(`${operation}_move`))
        : frame.progress(`${operation}_move`);
      const cut =
        operation === 'divide'
          ? frame.reduced
            ? Number(frame.finished('divide_cut'))
            : frame.progress('divide_cut')
          : 0;
      const done = frame.finished(`${operation}_move`);
      drawing.resize(width, height, false);
      for (const [id, diagram] of Object.entries(diagrams)) diagram.root.show(id === operation);
      const shown = diagrams[operation].render({ width, narrow, progress, cut });
      if (choose.value !== operation) choose.setValue(operation);
      root.dataset.operation = operation;
      root.dataset.phase = done
        ? 'result'
        : progress > 0
          ? 'moving'
          : cut > 0 && operation === 'divide'
            ? 'cutting'
            : 'before';
      if (current?.operation !== operation) {
        heading.textContent = lesson.title;
        question.textContent = lesson.question;
      }
      const expression = `${lesson.expression} = ${done ? lesson.answer : '?'}`;
      if (equation.textContent !== expression) equation.textContent = expression;
      equation.dataset.solved = String(done);
      const explanation = done ? lesson.conclusion : lesson.action;
      if (conclusion.textContent !== explanation) conclusion.textContent = explanation;
      current = {
        operation,
        progress,
        cut,
        done,
        equation: equation.textContent,
        result: done ? lesson.output : undefined,
        ...shown,
      };
    },
  });
  root.scene.extend({
    snapshot: () => ({ ...current }),
    svg: () => drawing.element,
    checkpoints: lessons.flatMap(({ start }) => [start, start + 3.5, start + 5, start + 7.5]),
  });
  shell.onDispose(() => {
    choose.dispose();
    drawing.dispose();
  });
})().catch((error) => {
  const message = document.createElement('p');
  message.setAttribute('role', 'alert');
  message.textContent = error.message;
  document.getElementById('arithmetic-objects').append(message);
  throw error;
});
