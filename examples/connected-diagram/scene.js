import { SceneShell, explanationLayout } from '@visual-storytelling/core';
import { disclosure } from '@visual-storytelling/core/controls';
import { Viewport3D } from '@visual-storytelling/core/three';
import { recurrentDiagram } from './drawing.js';
import '@visual-storytelling/core/style.css';

const words = ['кот', 'на', 'крыше'],
  answer = ['the', 'cat', 'is', 'on', 'the', 'roof'];
const script = {
  duration: 14,
  segments: [
    {
      id: 'read',
      title: 'Прочитать по одному слову',
      start: 0,
      end: 5,
      text: 'В этой упрощённой рекуррентной схеме кодировщик читает слова по очереди. Каждое слово обновляет состояние.',
    },
    {
      id: 'transfer',
      title: 'Передать последнее состояние',
      start: 5,
      end: 8,
      text: 'После трёх слов кодировщик передаёт последнее состояние декодировщику.',
    },
    {
      id: 'answer',
      title: 'Построить выходную фразу',
      start: 8,
      end: 14,
      text: 'Декодировщик использует состояние и предыдущее выходное слово, чтобы выбрать следующее. Петля показывает повтор этого шага.',
    },
  ],
  cues: {
    read: { start: 0, end: 5, action: 'Слово обновляет состояние кодировщика.' },
    memory: { start: 5, end: 8, action: 'Последнее состояние переходит к декодировщику.' },
    answer: { start: 8, end: 14, action: 'Повторяем шаг декодировщика для следующего слова.' },
  },
};
function sequence(time, reduced) {
  const reading = Math.min(3, (time / 5) * 3),
    decoding = Math.max(0, Math.min(6, time - 8)),
    phase = time < 5 ? 'read' : time < 8 ? 'transfer' : 'answer';
  return {
    time,
    reduced,
    phase,
    active: Math.min(2, Math.floor(reading)),
    completed: Math.floor(reading),
    output: answer.slice(0, Math.floor(decoding)),
    progress: phase === 'read' ? reading % 1 : phase === 'transfer' ? (time - 5) / 3 : decoding % 1,
  };
}
const text = (element, value) => {
  if (element.textContent !== value) element.textContent = value;
};

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('diagram');
  const shell = SceneShell.mount(root, {
    title: 'Как состояние связывает вход и ответ',
    parameters: [
      { key: 'column', type: 'toggle', label: 'Расположить в столбик', value: false },
      { key: 'details', type: 'toggle', label: 'Что хранится в состоянии?', value: false },
      {
        key: 'time',
        label: 'Момент',
        value: 0,
        min: 0,
        max: 14,
        step: 0.05,
        format: (v) => `${Number(v).toFixed(1)} с`,
      },
    ],
  });
  shell.showParameters(['time', 'column']);
  const layout = explanationLayout(shell.stage);
  layout.figure.classList.add('ve-stage');
  layout.figure.setAttribute('aria-label', 'Рекуррентная схема');
  layout.controls.append(shell.fields);
  shell.fields.style.gridTemplateColumns = 'minmax(0, 1fr)';
  layout.footer.append(shell.actions);
  const arrangement = document.createElement('p');
  arrangement.className = 've-note';
  arrangement.textContent = 'На этой ширине схема уже расположена в столбик.';
  layout.controls.append(arrangement);
  layout.notes.setAttribute('aria-label', 'Что происходит с состоянием');
  layout.notes.innerHTML = `
    <p class="ve-eyebrow">Упрощённая рекуррентная схема</p>
    <p class="ve-reading" data-sequence-reading aria-live="polite" aria-atomic="true"></p>
    <p data-sequence-cause></p>
    <p class="ve-note">Пример перевода: «кот на крыше» → «the cat is on the roof».</p>`;
  const details = disclosure(layout.notes, {
    label: 'Что хранится в состоянии?',
    onChange: (details) => shell.input({ details }),
  });
  details.body.innerHTML = `
    <p><strong>Состояние</strong> — набор чисел, который кодировщик обновляет после каждого слова.</p>
    <p class="ve-equation">h₀ → h₁ → h₂ → h₃</p>
    <p>Последнее состояние h₃ переходит к декодировщику. Дальше его собственное состояние меняется с каждым выходным словом.</p>
    <p class="ve-note">Выходные слова заданы как пример. Стрелки показывают порядок передачи данных.</p>`;
  const reading = layout.notes.querySelector('[data-sequence-reading]'),
    cause = layout.notes.querySelector('[data-sequence-cause]');
  const view = Viewport3D.mount(layout.figure, {
    label: 'Слова, кодировщик, состояние и декодировщик',
  });
  shell.attachView(view);
  const drawing = recurrentDiagram(view, words);
  let current;
  const story = shell.attachStory({
    script,
    stateAt: (frame) => ({ column: false, details: false, time: frame.time }),
    render(state, frame, mode) {
      current = sequence(mode === 'story' ? frame.time : Number(state.time), frame.reduced);
      const automaticColumn = layout.figure.clientWidth < 560,
        column = Boolean(state.column) || automaticColumn;
      layout.figure.style.height = column ? '500px' : '360px';
      layout.figure.dataset.sequenceLayout = column ? 'column' : 'row';
      shell.describeParameter('column', { disabled: automaticColumn });
      arrangement.hidden = !automaticColumn || mode === 'story';
      drawing.render(current, column);
      details.set(Boolean(state.details));
      if (current.phase === 'read') {
        text(reading, `Читаем «${words[current.active]}».`);
        text(
          cause,
          `Прочитано ${current.completed} из 3 слов. Каждое новое слово обновляет прежнее состояние.`,
        );
      } else if (current.phase === 'transfer') {
        text(reading, 'Три слова — последнее состояние h₃.');
        text(cause, 'Кодировщик закончил чтение. Сигнал переносит его состояние в декодировщик.');
      } else {
        text(
          reading,
          current.output.length ? current.output.join(' ') : 'Декодировщик начинает фразу.',
        );
        text(
          cause,
          current.output.length === answer.length
            ? 'Фраза готова. Каждый проход по петле добавил одно выходное слово.'
            : 'Каждый проход по петле использует прежнее состояние и выходное слово, чтобы выбрать следующее.',
        );
      }
    },
  });
  root.scene.extend({ view, story, snapshot: () => ({ ...current, ...drawing.snapshot() }) });
  const selected = () => {
    if (root.scene.selected.includes('recurrent-state') && !story.requested.values.details)
      shell.input({ details: true });
  };
  root.addEventListener('scene-selection', selected);
  let width = layout.figure.clientWidth;
  const resize = new ResizeObserver(() => {
    const next = layout.figure.clientWidth;
    if (width !== next) {
      width = next;
      story.update();
    }
  });
  resize.observe(layout.figure);
  shell.onDispose(() => {
    resize.disconnect();
    root.removeEventListener('scene-selection', selected);
    details.dispose();
    layout.dispose();
  });
  return { shell, story };
})();
