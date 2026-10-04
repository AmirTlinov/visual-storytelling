import { MorphStory, MathMorph } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import './style.css';
import { chapters, createValley, n } from './models.js';
import script from './timeline.json';

const root = document.getElementById('gradient');
window.galleryReady = MorphStory.mount(root, {
  title: 'Как спуститься по узкой долине?',
  presenter: MathMorph,
  initial: { alpha: 0.14, beta: 0.7, u0: 2.6, v0: 0.85 },
  parameters: [
    { key: 'alpha', label: 'Обычный шаг α', min: 0.02, max: 0.17, step: 0.005, format: n },
    { key: 'beta', label: 'Шаг с H⁻¹: β', min: 0.1, max: 1.1, step: 0.05, format: n },
    { key: 'u0', label: 'Старт вдоль: u', min: -3, max: 3, step: 0.1, format: n },
    { key: 'v0', label: 'Старт поперёк: v', min: -1, max: 1, step: 0.05, format: n },
  ],
  script,
  audio: root.querySelector('audio'),
  chapters: chapters.map(({ id, cues }) => ({
    id,
    cues,
    descriptions: { beta: { disabled: id !== 'precondition' } },
    operation: (parameters) => createValley({ ...parameters, chapter: id }),
  })),
}).then((handle) => {
  const premise = document.createElement('p');
  premise.className = 'premise';
  premise.textContent = 'f = (u² + 12v²) / 2 · q = (x,y) = R(u,v), где R — поворот на 35°';
  handle.shell.stage.prepend(premise);
  return handle;
});
