import { inkChapter } from '@visual-storytelling/core/story';
import { areaDiagram } from '@visual-storytelling/core/recipes';
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
    inkChapter({
      id: 'measure',
      title: 'Сколько места занимает идея?',
      text: 'Квадратный сантиметр занимает четыре маленькие клетки.',
      seconds: 9,
      controls: ['width', 'height'],
      valuesAt: () => ({ width: 3, height: 2 }),
      create: areaDiagram,
    }),
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
