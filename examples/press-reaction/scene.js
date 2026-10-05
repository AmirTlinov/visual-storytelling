import {
  CharacterStory,
  chibi,
  readingRoom,
  arrange,
  portable,
  bulb,
} from '@visual-storytelling/core/characters';
import '@visual-storytelling/core/style.css';

const set = arrange(readingRoom({ theme: 'laboratory' }), {
  objects: {
    book: null,
    plant: null,
    seat: null,
    meter: {
      ...portable('instrument', { x: 0, z: 0 }),
      at: { of: 'sideTable', side: 'on' },
    },
    lampTable: {
      kind: 'table',
      scale: 0.65,
      at: { of: 'sideTable', side: 'right', gap: 1.6 },
    },
  },
  spots: { lamp: { of: 'lampTable', side: 'on' } },
});
const shot = { focus: ['hero', 'meter', 'lamp'], framing: 'medium' };

window.galleryReady = CharacterStory.mount(document.getElementById('press-reaction'), {
  title: 'Нажатие запускает опыт',
  description: 'Тесла подходит к кнопке. Лампа загорается после нажатия и гаснет после второго.',
  camera: 'responsive',
  pack: chibi,
  set,
  cast: { hero: { skin: 'tesla-workshop', at: 'entry', scale: 0.77 } },
  props: { lamp: { art: bulb, at: 'lamp', values: { light: 0 } } },
  beats: [
    {
      id: 'observe',
      title: 'До нажатия',
      text: 'Пока прибор выключен, лампа не светится.',
      seconds: 1.5,
      shot,
    },
    {
      id: 'on',
      title: 'Включить лампу',
      text: 'Тесла подходит и нажимает кнопку. Только теперь загорается лампа.',
      shot,
      perform: [{ action: 'press', actor: 'hero', target: 'meter' }],
      props: { lamp: { on: { press: 'meter' }, values: { light: 1 }, over: 0.5 } },
    },
    {
      id: 'lit',
      title: 'Лампа горит',
      text: 'Лампа сохраняет своё состояние.',
      seconds: 1.5,
      shot,
    },
    {
      id: 'off',
      title: 'Выключить лампу',
      text: 'Следующее нажатие выключает лампу.',
      shot,
      perform: [{ action: 'press', actor: 'hero', target: 'meter' }],
      props: { lamp: { on: { press: 'meter' }, values: { light: 0 } } },
    },
    {
      id: 'end',
      title: 'Проверить ещё раз',
      text: 'Верните время назад и проследите момент включения.',
      seconds: 1.5,
      shot,
    },
  ],
});
