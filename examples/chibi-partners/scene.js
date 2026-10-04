import { CharacterStory, chibi, street } from '@visual-storytelling/core/characters';
import '@visual-storytelling/core/style.css';

window.galleryReady = CharacterStory.mount(document.getElementById('chibi-partners'), {
  title: 'Тесла и Мира · Вместе',
  description: 'Встреча и прогулка. Общая точка контакта для героев разного роста.',
  pack: chibi,
  set: street({ theme: 'park' }),
  cast: {
    tesla: { skin: 'tesla', at: 'left', scale: 0.77 },
    mira: { skin: 'mira', at: 'right', scale: 0.64 },
  },
  beats: [
    { id: 'meet', seconds: 1, title: 'Встреча', text: 'Мысль готова — можно поделиться.' },
    {
      id: 'five',
      seconds: 3,
      title: 'Дай пять!',
      text: 'Получилось!',
      actors: { tesla: 'excited', mira: 'excited' },
      perform: [{ action: 'highFive', actors: ['tesla', 'mira'] }],
    },
    {
      id: 'walk',
      seconds: 6,
      title: 'Пойдём вместе',
      text: 'Они берутся за руки и идут вдоль парка.',
      actors: { tesla: 'idle', mira: 'idle' },
      perform: [{ action: 'walkTogether', actors: ['tesla', 'mira'], to: 'near' }],
    },
    { id: 'bye', seconds: 2, title: 'Новая история', text: 'Что откроется на следующей странице?' },
  ],
});
