import { chibi, readingRoom, arrange, bulb } from '@visual-storytelling/core/characters';

const meterArt = {
  title: 'Стрелочный прибор',
  width: 132,
  height: 152,
  grip: { x: -48, y: -28 },
  svg: `<g stroke="#304650" stroke-width="2.6" stroke-linejoin="round">
    <path d="M-62 0v-140q0-9 9-9H53q9 0 9 9V0Z" fill="#96734f"/>
    <path d="M-53-136H53v86H-53Z" fill="#e9e2ce"/>
    <path d="M-42-74a46 46 0 0 1 84 0M-36-92l7 4M0-111v8m36 11-7 4" fill="none" stroke="#758587"/>
    <path data-dial d="M0-67v-36" stroke="#aa583f" stroke-width="3.4" stroke-linecap="round"/>
    <circle cy="-67" r="4" fill="#304650"/>
    <circle data-button cy="-21" r="9" fill="#658f84"/>
    <path d="M-50-34v20m6-20v20m88-20v20m6-20v20" stroke="#644e3c" stroke-width="2"/>
  </g>`,
  paint(node, { dial = 0, active = 0 }) {
    node
      .querySelector('[data-dial]')
      .setAttribute('transform', `rotate(${-55 + 110 * dial} 0 -67)`);
    node.querySelector('[data-button]').setAttribute('fill', active ? '#ead67d' : '#658f84');
  },
};

const set = arrange(readingRoom({ theme: 'laboratory' }), {
  objects: {
    book: null,
    plant: null,
    seat: null,
    meter: {
      kind: 'prop',
      art: meterArt,
      values: { dial: 0 },
      trigger: { at: { x: 0, z: 0, height: 0.21 }, effect: 'toggle' },
      at: { of: 'sideTable', side: 'on' },
    },
    lampTable: {
      kind: 'table',
      scale: 0.65,
      at: { of: 'sideTable', side: 'right', gap: 1.6 },
    },
    lamp: {
      kind: 'prop',
      at: { of: 'lampTable', side: 'on' },
      art: { ...bulb, title: 'Лампа', width: 190, height: 190, grip: { x: 0, y: -35 } },
      values: { light: 0 },
    },
  },
});
const shot = { focus: ['hero', 'meter', 'lamp'], framing: 'medium' };

export const experiment = {
  title: 'Нажатие запускает опыт',
  description: 'Нажатие меняет шкалу и включает лампу. При переносе прибор сохраняет показание.',
  camera: 'responsive',
  pack: chibi,
  set,
  cast: { hero: { skin: 'tesla-workshop', at: 'entry', scale: 0.77 } },
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
      props: {
        meter: { on: { press: 'meter' }, values: { dial: 0.8 }, over: 0.7 },
        lamp: { on: { press: 'meter' }, values: { light: 1 }, over: 0.5 },
      },
    },
    {
      id: 'lit',
      title: 'Лампа горит',
      text: 'Лампа сохраняет своё состояние.',
      seconds: 1.5,
      shot,
    },
    {
      id: 'take',
      title: 'Взять прибор',
      text: 'Тесла берёт работающий прибор. Показание сохраняется.',
      shot,
      perform: [{ action: 'take', actor: 'hero', object: 'meter' }],
    },
    {
      id: 'carry',
      title: 'Перенести',
      text: 'Шкала остаётся частью прибора во время движения.',
      shot: { focus: ['hero', 'meter'], framing: 'medium' },
      perform: [{ action: 'walk', actor: 'hero', to: 'entry' }],
    },
    {
      id: 'put',
      title: 'Вернуть на стол',
      text: 'Прибор возвращается на прежнюю опору с тем же показанием.',
      shot,
      perform: [{ action: 'put', actor: 'hero', onto: 'sideTable' }],
    },
    {
      id: 'off',
      title: 'Выключить лампу',
      text: 'Следующее нажатие выключает лампу.',
      shot,
      perform: [{ action: 'press', actor: 'hero', target: 'meter' }],
      props: {
        meter: { on: { press: 'meter' }, values: { dial: 0 }, over: 0.7 },
        lamp: { on: { press: 'meter' }, values: { light: 0 }, over: 0.5 },
      },
    },
    {
      id: 'end',
      title: 'Проверить ещё раз',
      text: 'Верните время назад и проследите момент включения.',
      seconds: 1.5,
      shot,
    },
  ],
};
