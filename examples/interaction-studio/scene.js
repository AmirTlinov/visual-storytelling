import { Storybook } from '@visual-storytelling/core/book';
import { inkChapter } from '@visual-storytelling/core/story';
import { areaDiagram } from '@visual-storytelling/core/recipes';
import { surface, lettering } from '@visual-storytelling/core';
import { snapshotSVG } from '@visual-storytelling/core/export';
import { chibi, readingRoom, arrange, portable } from '@visual-storytelling/core/characters';
import { Physics2D, PhysicsReplay } from '@visual-storytelling/core/physics/2d';
import '@visual-storytelling/core/style.css';

const alternate = new URL(location.href).searchParams.get('variant') === 'mira';
const room = arrange(readingRoom({ theme: alternate ? 'library' : 'laboratory', seat: 'bench' }), {
  objects: {
    book: null,
    sideTable: { scale: 0.55 },
    seat: { at: { of: 'sideTable', side: 'left', gap: 1.4, offset: { x: 0, z: 1.5 } } },
    letter: {
      ...portable('letter', { x: 0, z: 0 }),
      at: { of: 'sideTable', side: 'on', offset: { x: -0.38, z: 0 } },
    },
    meter: {
      ...portable('instrument', { x: 0, z: 0 }),
      at: { of: 'sideTable', side: 'on', offset: { x: 0.38, z: 0 } },
    },
  },
});
const hero = {
  skin: alternate ? 'mira-scholar' : 'tesla-workshop',
  scale: alternate ? 0.64 : 0.8,
  at: 'entry',
};
const cast = {
  hero,
  friend: {
    skin: alternate ? 'tesla' : 'mira',
    scale: alternate ? 0.77 : 0.64,
    at: { of: 'seat', side: 'left', gap: 1, offset: { x: 0, z: -1 } },
  },
};

// The simulation uses the same chapter clock, controls, capture and replay as the cast.
const experiment = {
  id: 'experiment',
  title: 'Три материала',
  seconds: 5,
  text: 'Одинаковая высота. Разные материалы. Посмотрите, как они отскакивают.',
  async mount(parent) {
    const view = surface(parent, {
      id: 'materials-chapter',
      width: 960,
      height: 640,
      title: 'Материалы',
      description: this.text,
      grid: { step: 40 },
    });
    const world = await Physics2D.create(),
      ink = Physics2D.ink(world, view, { scale: 100 });
    ink.body('floor', { shape: { box: [8.5, 0.16] }, at: [4.8, 5.2], fixed: true, pigment: 'ink' });
    const bodies = ['solid', 'rubber', 'jelly'].map((material, i) =>
      ink.body(material, {
        shape: { circle: 0.5 },
        at: [2.3 + i * 2.5, 1.4],
        material,
        pigment: ['blue', 'orange', 'purple'][i],
        draggable: false,
      }),
    );
    ['Твёрдый', 'Упругий', 'Мягкий'].forEach((label, i) =>
      lettering(view.layer, label, { x: 230 + i * 250, y: 65, size: 42 }),
    );
    const replay = PhysicsReplay.create(world, { duration: this.seconds });
    return {
      render: (frame) => replay.seek(frame.time),
      capture: () => snapshotSVG(view.element),
      snapshot: () => ({
        time: replay.currentTime,
        bodies: bodies.map((b) => ({ id: b.id, position: b.position })),
      }),
      dispose() {
        world.dispose();
        view.dispose();
      },
    };
  },
};
window.galleryReady = Storybook.mount(document.getElementById('interaction-studio'), {
  topic: 'Письмо из мастерской',
  pack: chibi,
  parameters: [
    { key: 'width', label: 'Ширина, см', value: 3, min: 1, max: 6, step: 1 },
    { key: 'height', label: 'Высота, см', value: 2, min: 1, max: 5, step: 1 },
  ],
  chapters: [
    {
      id: 'letter',
      title: 'Прочитать — и проверить',
      set: room,
      cast,
      beats: [
        {
          id: 'take',
          seconds: 4,
          text: 'В письме предложен новый опыт.',
          perform: [{ action: 'take', actor: 'hero', object: 'letter' }],
        },
        {
          id: 'switch',
          seconds: 4,
          text: 'Свободной рукой включаем прибор.',
          shot: { focus: ['hero.face', 'hero.hand-right', 'letter', 'meter'], framing: 'detail' },
          perform: [{ action: 'press', actor: 'hero', target: 'meter' }],
        },
        {
          id: 'put',
          seconds: 4,
          text: 'Оставим письмо на скамье.',
          perform: [{ action: 'put', actor: 'hero', onto: 'seat' }],
        },
        {
          id: 'sit',
          seconds: 4,
          text: 'Рядом достаточно места для двоих.',
          perform: [
            { action: 'sit', actor: 'hero', seat: 'seat' },
            { action: 'sit', actor: 'friend', seat: 'seat' },
          ],
        },
      ],
    },
    inkChapter({
      id: 'measure',
      title: 'Одинаковая мера',
      text: 'Для сравнения нужна общая мера.',
      seconds: 7,
      controls: ['width', 'height'],
      valuesAt: () => ({ width: 3, height: 2 }),
      create: areaDiagram,
    }),
    experiment,
  ],
});
