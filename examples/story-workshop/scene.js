import { Storybook } from '@visual-storytelling/core/book';
import {
  chibi,
  arrange,
  readingRoom,
  courtyard,
  street,
  routines,
} from '@visual-storytelling/core/characters';
import '@visual-storytelling/core/style.css';

const alternate = new URL(location.href).searchParams.get('variant') === 'tesla';
const hero = {
  skin: alternate ? 'tesla-field' : 'mira-lab',
  scale: alternate ? 0.8 : 0.64,
  at: 'entry',
};
const arrival = courtyard({
  theme: alternate ? 'library' : 'workshop',
  perspective: alternate ? 'overview' : 'stage',
});
const room = arrange(
  readingRoom({
    theme: alternate ? 'laboratory' : 'library',
    perspective: alternate ? 'overview' : 'stage',
  }),
  {
    objects: {
      sideTable: { at: { of: 'seat', side: 'right', gap: 1.35 } },
      book: { at: { of: 'sideTable', side: 'on' } },
    },
  },
);

// This file describes the story. Contacts, waypoints, poses, cuts and page turns live in the library.
window.galleryReady = Storybook.mount(document.getElementById('story-workshop'), {
  topic: 'Дом мыслей',
  pack: chibi,
  parameters: [
    { key: 'width', label: 'Ширина, см', value: 3, min: 1, max: 6, step: 1 },
    { key: 'height', label: 'Высота, см', value: 2, min: 1, max: 5, step: 1 },
  ],
  chapters: [
    {
      id: 'arrival',
      title: 'За дверью — вопрос',
      set: arrival,
      cast: { hero },
      beats: routines.enter('arrive', 'hero'),
    },
    {
      id: 'reading',
      title: 'Ответ начинается с книги',
      set: room,
      cast: { hero },
      beats: [
        ...routines.read('read', { actor: 'hero', pages: 2 }),
        { id: 'stuck', seconds: 2.5, text: 'Пока ничего не сходится.', actors: { hero: 'cry' } },
        { id: 'idea', seconds: 2.5, text: 'Нужна одна понятная мера!', actors: { hero: 'idea' } },
      ],
    },
    {
      id: 'measure',
      title: 'Сколько места занимает идея?',
      text: 'Квадратный сантиметр занимает четыре маленькие клетки.',
      seconds: 9,
      controls: ['width', 'height'],
      valuesAt: () => ({ width: 3, height: 2 }),
      describe: ({ values }) =>
        `Прямоугольник ${values.width} × ${values.height} см: ${Number(values.width) * Number(values.height)} см².`,
      draw(page, frame) {
        const w = Number(frame.values.width),
          h = Number(frame.values.height);
        const count =
          frame.mode === 'explore'
            ? w * h
            : Math.min(w * h, Math.floor(frame.progress * (w * h + 2)));
        page.rect('area', { x: 2, y: 2, width: w, height: h }, page.ink('blue', 0.06));
        for (let i = 0; i < count; i++)
          page.rect('unit-' + i, { x: 2 + (i % w), y: 2 + Math.floor(i / w), width: 1, height: 1 });
        page.line('measure', [2, h + 2.5], [w + 2, h + 2.5]);
        page.text('width', `${w} см`, 2 + w / 2, h + 3.2, { align: 'center', size: 0.5 });
        page.text('formula', `${w} × ${h} = ${w * h} см²`, 9.5, 3.5, {
          size: 0.75,
          color: page.ink('blue'),
        });
        page.rect(
          'one-cm',
          { x: 10, y: 5.5, width: 1, height: 1 },
          page.ink('orange', 0.18),
          page.ink('orange'),
        );
        page.text('four-cells', '1 см² = 4 клетки', 9.5, 7.5, { size: 0.55 });
        page.text('try', 'Проверьте сами: измените стороны.', 2, 10.5, { size: 0.58 });
      },
    },
    {
      id: 'courtyard',
      title: 'Проверить с другой высоты',
      set: arrange(arrival, { objects: { door: { open: 1 } } }),
      cast: { hero: { ...hero, at: 'inside' } },
      beats: [
        ...routines.leave('leave', 'hero'),
        ...routines.stairs('stairs', 'hero'),
        { id: 'relief', seconds: 2, text: 'Теперь понятно!', actors: { hero: 'celebrate' } },
      ],
    },
    {
      id: 'together',
      title: 'Идеей можно поделиться',
      set: street({ theme: 'park' }),
      cast: {
        hero: { ...hero, at: 'left' },
        friend: { skin: alternate ? 'mira' : 'tesla', scale: alternate ? 0.64 : 0.77, at: 'right' },
      },
      beats: [
        {
          id: 'tap',
          seconds: 2.5,
          text: 'Проверим вместе!',
          perform: [{ action: 'handTap', actors: ['hero', 'friend'] }],
        },
        ...routines.greet('friends', ['hero', 'friend']),
      ],
    },
  ],
});
