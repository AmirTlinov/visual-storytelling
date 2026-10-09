import { SceneShell } from '@visual-storytelling/core';
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
window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('diagram');
  const shell = SceneShell.mount(root, {
    title: 'Как состояние связывает вход и ответ',
    parameters: [
      { key: 'details', type: 'toggle', label: 'Цепь состояний', value: false },
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
  shell.showParameters(['time']);
  shell.stage.dataset.sequenceLayout = 'row';
  const view = Viewport3D.mount(shell.stage, {
    label: 'Слова, кодировщик, состояние и декодировщик',
  });
  shell.attachView(view);
  const drawing = recurrentDiagram(view, words, answer);
  let current;
  const story = shell.attachStory({
    script,
    stateAt: (frame) => ({ details: frame.time >= 5 && frame.time < 8, time: frame.time }),
    render(state, frame, mode) {
      current = sequence(mode === 'story' ? frame.time : Number(state.time), frame.reduced);
      drawing.render(current, Boolean(state.details));
    },
  });
  root.scene.extend({ view, story, snapshot: () => ({ ...current, ...drawing.snapshot() }) });
  const selected = () => {
    const ids = root.scene.selected;
    const word = words.findIndex((_, index) => ids.includes(`input-word-${index}`));
    if (word >= 0) shell.input({ time: ((word + 0.5) * 5) / 3 });
    else shell.input({ details: ids.includes('recurrent-state') });
  };
  root.addEventListener('scene-selection', selected);
  shell.onDispose(() => {
    root.removeEventListener('scene-selection', selected);
  });
  return { shell, story };
})();
