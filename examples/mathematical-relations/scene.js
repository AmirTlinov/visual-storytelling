import { SceneShell, MathMorph } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';
import { chapters } from './models.js';
import script from './timeline.json';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('relations');
  const shell = SceneShell.mount(root, {
    title: 'Одна связь — весь рисунок',
    parameters: [
      {
        key: 'chapter',
        type: 'select',
        label: 'Исследование',
        value: chapters[0].id,
        options: chapters.map((c) => ({ value: c.id, label: c.title })),
      },
      {
        key: 'progress',
        label: 'Преобразование',
        min: 0,
        max: 1,
        step: 0.005,
        value: 0,
        format: (p) => `${Math.round(p * 100)}%`,
      },
    ],
  });
  const plans = new Map(chapters.map((c) => [c.id, c.create()]));
  const drawing = await MathMorph.mount(shell.stage, plans.get(chapters[0].id));
  shell.attachView(drawing.view);
  let previous = chapters[0].id;
  shell.attachStory({
    script,
    audio: root.querySelector('audio'),
    stateAt(frame) {
      const chapter = chapters.findLast((c) => frame.has(c.id)) ?? chapters[0];
      const cues = Object.keys(script.cues).filter((id) => id.startsWith(`${chapter.id}_`));
      return {
        chapter: chapter.id,
        progress: MathMorph.timing(frame, cues, plans.get(chapter.id).stages).progress,
      };
    },
    render(state, frame, mode) {
      if (previous !== state.chapter) {
        drawing.setOperation(plans.get(state.chapter));
        previous = state.chapter;
      }
      const cues = Object.keys(script.cues).filter((id) => id.startsWith(`${state.chapter}_`));
      drawing.render(mode === 'story' ? frame : state.progress, cues);
    },
  });
})();
