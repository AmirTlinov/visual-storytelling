import { CharacterStory, chibi, conservatory } from '@visual-storytelling/core/characters';
import '@visual-storytelling/core/style.css';

window.galleryReady = CharacterStory.mount(document.getElementById('chibi-garden'), {
  title: 'Мира · Дать ростку время',
  description:
    'Мира ждёт у горшка в оранжерее. Маленький росток раскрывает листья, и она радуется.',
  remember: 'chibi-garden',
  pack: chibi,
  set: conservatory(),
  cast: { mira: { skin: 'mira', at: 'center' } },
  beats: [
    {
      id: 'wait',
      title: 'Пока совсем маленький',
      seconds: 2.6,
      text: 'Пока виден лишь маленький росток.',
      actors: { mira: 'think' },
    },
    {
      id: 'grow',
      title: 'Дать ростку время',
      seconds: 3.4,
      text: 'Проходит время. Стебель поднимается и разворачивает листья.',
      actors: { mira: 'excited' },
      props: { plant: { values: { growth: 1 } } },
    },
    {
      id: 'happy',
      title: 'Листья раскрылись',
      seconds: 2.5,
      text: 'Теперь маленький росток стал заметным растением.',
      actors: { mira: 'celebrate' },
    },
  ],
});
