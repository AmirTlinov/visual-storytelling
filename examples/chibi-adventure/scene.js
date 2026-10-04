import { CharacterStory, chibi, courtyard } from '@visual-storytelling/core/characters';
import '@visual-storytelling/core/style.css';
const variant = new URL(location.href).searchParams.get('variant') === 'tesla';
window.galleryReady = CharacterStory.mount(document.getElementById('chibi-adventure'), {
  title: 'За следующей дверью',
  description: 'Дверь, бег, лестница и эмоции на общей постановке.',
  pack: chibi,
  set: courtyard(variant ? { theme: 'library', entranceScale: 1.08 } : {}),
  cast: { mira: { skin: variant ? 'tesla' : 'mira', at: 'entry', scale: variant ? 0.8 : 0.64 } },
  beats: [
    {
      id: 'door',
      seconds: 6,
      title: 'За следующей дверью',
      text: 'Подойти к ручке и потянуть дверь на себя.',
      perform: [{ action: 'openDoor', actor: 'mira', door: 'door' }],
    },
    {
      id: 'enter',
      seconds: 3.5,
      title: 'Свет за порогом',
      text: 'Внутри — свет из окна и дощатый пол.',
      perform: [{ action: 'passDoor', actor: 'mira', door: 'door', to: 'inside' }],
    },
    {
      id: 'fear',
      seconds: 2,
      title: 'Что там шевельнулось?',
      text: 'Из глубины комнаты донёсся шорох.',
      actors: { mira: 'scared' },
    },
    {
      id: 'outside',
      seconds: 2.8,
      title: 'Обратно во двор',
      text: 'Выйти через тот же порог.',
      actors: { mira: 'scared' },
      perform: [{ action: 'passDoor', actor: 'mira', door: 'door', to: 'outside', gait: 'run' }],
    },
    {
      id: 'run',
      seconds: 3,
      title: 'Скорее наверх!',
      text: 'Бегом к лестнице.',
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
