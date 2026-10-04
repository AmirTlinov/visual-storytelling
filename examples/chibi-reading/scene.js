import { CharacterStory, chibi, readingRoom } from '@visual-storytelling/core/characters';
import '@visual-storytelling/core/style.css';

const variant = new URL(location.href).searchParams.get('variant') === 'mira';
window.galleryReady = CharacterStory.mount(document.getElementById('chibi-reading'), {
  title: variant ? 'Мира · Тихая глава' : 'Тесла · Тихая глава',
  description:
    'Подойти, сесть, перелистать книгу. Один рецепт привязывает руки и ноги к предметам.',
  pack: chibi,
  set: readingRoom(
    variant ? { theme: 'laboratory', seat: 'bench', furnitureScale: 1.15, depth: 2 } : {},
  ),
  cast: { reader: { skin: variant ? 'mira' : 'tesla', at: 'entry', scale: variant ? 0.64 : 0.8 } },
  beats: [
    {
      id: 'take',
      title: 'На столе ждёт книга',
      seconds: 5,
      text: 'Здесь есть то, что поможет разобраться.',
      perform: [{ action: 'take', actor: 'reader', object: 'book' }],
    },
    {
      id: 'enter',
      title: 'Найти тихое место',
      seconds: 3.2,
      text: 'С книгой можно устроиться поближе к свету.',
      perform: [{ action: 'walk', actor: 'reader', to: 'reader' }],
    },
    {
      id: 'sit',
      title: 'Устроиться поудобнее',
      seconds: 1.8,
      text: 'Здесь удобно читать.',
      perform: [{ action: 'sit', actor: 'reader', seat: 'seat' }],
    },
    {
      id: 'read',
      title: 'Ещё одна страница',
      seconds: 7,
      text: 'Лист за листом: мысль постепенно проясняется.',
      perform: [{ action: 'read', actor: 'reader', book: 'book', pages: 3 }],
    },
    {
      id: 'up',
      title: 'Пора проверить идею',
      seconds: 1.4,
      text: 'Можно встать, продолжая держать книгу.',
      perform: [{ action: 'stand', actor: 'reader' }],
    },
    {
      id: 'put',
      title: 'Оставить книгу следующему читателю',
      seconds: 5,
      text: 'Идею можно проверить. Книга остаётся на столе.',
      perform: [{ action: 'put', actor: 'reader', onto: 'sideTable' }],
    },
    {
      id: 'leave',
      title: 'К эксперименту',
      seconds: 3.2,
      text: 'Теперь — в лабораторию.',
      perform: [{ action: 'walk', actor: 'reader', to: 'exit' }],
    },
  ],
});
