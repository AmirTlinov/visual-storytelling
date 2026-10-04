import { IllustratedStory } from '@visual-storytelling/core/book';
import { chibi, teachingRoom, arrange } from '@visual-storytelling/core/characters';
import { areaDiagram } from '@visual-storytelling/core/recipes';
import document from './story.json';
import '@visual-storytelling/core/style.css';
window.galleryReady = (async () => {
  const alternate = new URL(location.href).searchParams.has('variant');
  const audio = globalThis.document.querySelector('audio');
  const script =
    !audio || audio.dataset.silent === 'true'
      ? undefined
      : await fetch('timeline.json').then((r) => r.json());
  const drawing = {
    title: 'Одна общая мера',
    text: 'Клетка пять миллиметров; квадратный сантиметр содержит четыре клетки.',
    controls: ['width', 'height'],
    valuesAt: () => ({ width: 3, height: 2 }),
    create: areaDiagram,
  };
  const parameters = [
    { key: 'width', label: 'Ширина, см', value: 3, min: 1, max: 6, step: 1 },
    { key: 'height', label: 'Высота, см', value: 2, min: 1, max: 5, step: 1 },
  ];
  const drawingId = 'area',
    skin = 'mira-scholar',
    other = 'tesla-workshop';
  const room = teachingRoom({
    theme: alternate ? 'library' : 'laboratory',
    perspective: alternate ? 'overview' : 'stage',
  });
  const set = alternate
    ? arrange(room, { objects: { board: { at: { x: 0.7, z: 5.3 }, scale: 1.15 } } })
    : room;
  return IllustratedStory.mount(globalThis.document.getElementById('story'), {
    document: alternate ? { ...document, title: 'Тесла · Одна общая мера' } : document,
    script,
    audio,
    parameters,
    drawings: { [drawingId]: drawing },
    world: {
      pack: chibi,
      set,
      cast: {
        hero: {
          skin: alternate ? other : skin,
          scale: alternate ? 0.64 : 0.8,
          at: 'entry',
          action: 'think',
        },
      },
    },
  });
})();
