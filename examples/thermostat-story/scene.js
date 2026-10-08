import { IllustratedStory, inkChapter } from '@visual-storytelling/core/story';
import {
  chibi,
  teachingRoom,
  arrange,
  characterChapter,
} from '@visual-storytelling/core/characters';
import { flowDiagram, comparisonDiagram } from '@visual-storytelling/core/recipes';
import document from './story.json';
import '@visual-storytelling/core/style.css';
window.galleryReady = (async () => {
  const alternate = new URL(location.href).searchParams.has('variant');
  const audio = globalThis.document.querySelector('audio');
  const model = (v) => ({
    temperature: Number(v.temperature),
    target: Number(v.target),
    on: Number(v.temperature) < Number(v.target),
  });
  const controls = ['temperature', 'target'];
  const valuesAt = (frame) => ({ temperature: frame.beat?.id === 'idea' ? 24 : 18, target: 22 });
  const drawing = {
    title: 'Решение по правилу',
    text: 'Сравнение температуры с заданным порогом.',
    controls,
    valuesAt,
    create: (view) =>
      flowDiagram(view, {
        nodes: [
          { id: 'input', label: 'Датчик' },
          { id: 'rule', label: 'Сравнение' },
          { id: 'output', label: 'Нагрев', pigment: 'orange' },
        ],
        edges: [
          { from: 'input', to: 'rule' },
          { from: 'rule', to: 'output' },
        ],
        step: () => 3,
        values: ({ values }) => {
          const v = model(values);
          return {
            input: `${v.temperature} °C`,
            rule: `${v.temperature} < ${v.target}`,
            output: v.on ? 'включён' : 'выключен',
          };
        },
      }),
  };
  const parameters = [
    { key: 'temperature', label: 'Температура, °C', value: 18, min: 5, max: 30, step: 1 },
    { key: 'target', label: 'Порог, °C', value: 22, min: 10, max: 28, step: 1 },
  ];
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
  const comparison = {
    title: 'Общая шкала',
    controls,
    valuesAt,
    create: (view) =>
      comparisonDiagram(view, {
        items: [
          { id: 'temperature', label: 'Температура' },
          { id: 'target', label: 'Порог' },
        ],
        maximum: 30,
        unit: '°C',
        values: ({ values }) => {
          const v = model(values);
          return { temperature: v.temperature, target: v.target };
        },
        conclusion: ({ values }) => (model(values).on ? 'Нагрев включён' : 'Нагрев выключен'),
      }),
  };
  return IllustratedStory.mount(globalThis.document.getElementById('story'), {
    document: document,
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
      experiment: (chapter) => inkChapter({ ...comparison, ...chapter }),
    },
  });
})();
