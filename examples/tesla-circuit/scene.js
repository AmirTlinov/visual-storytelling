import { IllustratedStory } from '@visual-storytelling/core/book';
import { chibi, teachingRoom, arrange } from '@visual-storytelling/core/characters';
import document from './story.json';
import { circuitDiagram } from '@visual-storytelling/core/recipes';
import '@visual-storytelling/core/style.css';
window.galleryReady = (async () => {
  const alternate = new URL(location.href).searchParams.has('variant');
  const audio = globalThis.document.querySelector('audio');
  const script =
    !audio || audio.dataset.silent === 'true'
      ? undefined
      : await fetch('timeline.json').then((r) => r.json());
  const drawing = {
    title: 'Путь энергии',
    text: 'Источник, цепь и лампа.',
    controls: ['closed'],
    valuesAt: (frame) => ({ closed: frame.beat?.id !== 'explain' }),
    size: { width: 640, height: 250 },
    create: circuitDiagram,
  };
  const parameters = [{ key: 'closed', label: 'Цепь замкнута', type: 'toggle', value: true }];
  const drawingId = 'circuit',
    skin = 'tesla-workshop',
    other = 'mira-scholar';
  const room = teachingRoom({
    theme: alternate ? 'library' : 'laboratory',
    perspective: alternate ? 'overview' : 'stage',
  });
  const set = alternate
    ? arrange(room, { objects: { board: { at: { x: 0.7, z: 5.3 }, scale: 1.15 } } })
    : room;
  return IllustratedStory.mount(globalThis.document.getElementById('story'), {
    document: alternate ? { ...document, title: 'Мира · Путь к свету' } : document,
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
