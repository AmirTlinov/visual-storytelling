import { SceneShell, theme } from '@visual-storytelling/core';
import { CharacterStage, chibi, readingRoom, arrange } from '@visual-storytelling/core/characters';
import { NotebookPresentation } from '@visual-storytelling/core/book';
import { circuitDiagram } from '@visual-storytelling/core/recipes';
import '@visual-storytelling/core/style.css';

window.galleryReady = (async () => {
  await SceneShell.ready();
  const root = document.getElementById('notebook-entry');
  const colors = theme(root);
  const shell = SceneShell.mount(root, {
    title: 'Тесла · Живая страница',
    paper: false,
    frame: { width: 960, height: 650 },
    parameters: [{ key: 'closed', label: 'Цепь замкнута', type: 'toggle', value: true }],
  });
  shell.onDispose(colors.dispose);
  try {
    const stage = await CharacterStage.mount(shell.stage, {
      pack: chibi,
      camera: 'responsive',
      set: arrange(readingRoom({ theme: 'laboratory' }), { objects: { book: { open: 1 } } }),
      cast: { hero: { skin: 'tesla', at: 'entry', scale: 0.8 } },
      beats: [
        {
          id: 'observe',
          text: 'Тесла оставил схему в раскрытой тетради.',
          seconds: 12,
          actors: { hero: 'think' },
        },
      ],
      surfaces: {
        book: {
          title: 'Путь тока',
          size: { width: 640, height: 320 },
          create(view) {
            view.grid({ step: 20 });
            return circuitDiagram(view);
          },
        },
      },
    });
    shell.onDispose(stage.dispose);
    // Prepare the actual entry boundary once; the host remains the sole clock.
    stage.render(2);
    const entry = await NotebookPresentation.mount(shell.stage, {
      source: stage,
      book: 'book',
      topic: 'Путь тока',
    });
    shell.onDispose(entry.dispose);
    const story = shell.attachStory({
      script: {
        duration: 12,
        cues: {
          room: { start: 0, end: 2, action: 'В тетради на столе — схема опыта.' },
          enter: {
            start: 2,
            end: 4,
            action: 'Приблизимся. Ток продолжает двигаться во время полёта камеры.',
          },
          closed: { start: 4, end: 7, action: 'Путь замкнут, лампа светится.' },
          open: {
            start: 7,
            end: 12,
            action: 'Разрыв останавливает ток. Попробуйте замкнуть выключатель.',
          },
        },
      },
      stateAt: (frame) => ({ closed: frame.time < 7 }),
      render(values, frame, mode) {
        stage.render(frame.time, frame.reduced, {
          time: frame.time,
          progress: frame.time / 12,
          reduced: frame.reduced,
          mode,
          values,
          input: (changes) => story.explore({ ...story.values, ...changes }),
        });
        if (mode === 'explore') entry.render(1, frame.reduced);
        else if (frame.time < 2) entry.hide();
        else entry.render(frame.progress('enter'), frame.reduced);
      },
    });
    root.scene.extend({
      snapshot: () => ({ stage: stage.snapshot(), page: entry.snapshot() }),
    });
  } catch (error) {
    shell.dispose();
    throw error;
  }
})();
