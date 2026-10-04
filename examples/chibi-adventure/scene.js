import { CharacterStory, chibi, courtyard } from '@visual-storytelling/core/characters';
import '@visual-storytelling/core/style.css';
window.galleryReady = CharacterStory.mount(document.getElementById('chibi-adventure'), {
  title: 'Мира · За следующей дверью',
  description: 'Дверь, бег, лестница и эмоции на общей постановке.',
  pack: chibi,
  set: courtyard(),
  cast: { mira: { skin: 'mira', at: 'entry', scale: 0.64 } },
  beats: [
    {
      id: 'door',
      seconds: 6,
      title: 'За следующей дверью',
      text: 'Мира подходит к двери и тянет за ручку.',
      perform: [{ action: 'openDoor', actor: 'mira', door: 'door' }],
    },
    {
      id: 'fear',
      seconds: 2,
      title: 'Что там шевельнулось?',
      text: 'В темноте что-то шевельнулось.',
      actors: { mira: 'scared' },
    },
    {
      id: 'run',
      seconds: 3,
      title: 'Скорее наверх!',
      text: 'Она бежит к лестнице.',
      perform: [{ action: 'flee', actor: 'mira', to: 'stairs' }],
    },
    {
      id: 'stairs',
      seconds: 4.5,
      title: 'Ступень за ступенью',
      text: 'Поднимается на площадку.',
      actors: { mira: 'idle' },
      perform: [{ action: 'climb', actor: 'mira', stairs: 'stairs' }],
    },
    {
      id: 'relief',
      seconds: 2,
      title: 'Снова спокойно',
      text: 'Отсюда уже всё хорошо видно.',
      actors: { mira: 'idle' },
    },
  ],
});
