import { IllustratedStory, inkChapter } from '@visual-storytelling/core/story';
import {
  chibi,
  teachingRoom,
  arrange,
  characterChapter,
} from '@visual-storytelling/core/characters';
import document from './story.json';
import { circuitDiagram } from '@visual-storytelling/core/recipes';
import '@visual-storytelling/core/style.css';
window.galleryReady = (async () => {
  const alternate = new URL(location.href).searchParams.has('variant');
  const audio = globalThis.document.querySelector('audio');
  const drawing = {
    title: 'Путь энергии',
    text: 'Источник, цепь и лампа.',
    controls: ['closed'],
    valuesAt: (frame) => ({ closed: frame.beat?.id !== 'explain' }),
    size: { width: 640, height: 250 },
    create: circuitDiagram,
  };
  const parameters = [{ key: 'closed', label: 'Цепь замкнута', type: 'toggle', value: true }];
  const skin = 'tesla-workshop',
    other = 'mira-scholar';
  const room = teachingRoom({
    theme: alternate ? 'library' : 'laboratory',
    perspective: alternate ? 'overview' : 'stage',
  });
  const set = alternate
    ? arrange(room, { objects: { board: { at: { x: 0.7, z: 5.3 }, scale: 1.15 } } })
    : room;
  const world = {
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
  };
  return IllustratedStory.mount(globalThis.document.getElementById('story'), {
    document: alternate ? { ...document, title: 'Путь энергии: исследование цепи' } : document,
    audio,
    parameters,
    chapters: {
      workshop: (chapter) =>
        characterChapter({
          ...world,
          ...chapter,
          surfaces: { board: drawing },
          controls: drawing.controls,
          valuesAt: drawing.valuesAt,
        }),
      experiment: (chapter) => inkChapter({ ...drawing, ...chapter }),
    },
  });
})();
