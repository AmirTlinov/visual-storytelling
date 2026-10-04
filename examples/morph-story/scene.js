import { MorphStory, MathMorph, Morph } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

window.galleryReady = MorphStory.mount(document.getElementById('morph-story'), {
  title: 'Те же части, новое целое',
  presenter: MathMorph,
  initial: { amount: 6 },
  parameters: [{ key: 'amount', label: 'Количество в целом', min: 3, max: 12, step: 1 }],
  captions: true,
  script: {
    duration: 15,
    segments: [
      {
        id: 'parts',
        title: 'Целое становится тремя частями',
        start: 0,
        end: 5,
        text: 'Шесть делим на три равные части. Сколько останется в каждой?',
      },
      {
        id: 'double',
        title: 'Увеличиваем каждую часть',
        start: 5,
        end: 10,
        text: 'Теперь в каждой части по два. Удвоим каждую — что получится?',
      },
      {
        id: 'together',
        title: 'Собираем новое целое',
        start: 10,
        end: 14,
        text: 'У нас три четвёрки. Какое число получится, когда они соединятся?',
      },
      {
        id: 'result',
        title: 'Получилось двенадцать',
        start: 14,
        end: 15,
        text: 'Измените исходное количество и проверьте правило.',
      },
    ],
    cues: {
      split: { start: 1, end: 4, action: 'Целое делится на три равные части.' },
      grow: { start: 6, end: 9, action: 'Каждая часть удваивается.' },
      merge: { start: 11, end: 14, action: 'Части соединяются в новое целое.' },
    },
  },
  chapters: [
    {
      id: 'calculation',
      cues: ['split', 'grow', 'merge'],
      operation: ({ amount }) =>
        MathMorph.formula('sum(partition(x, 3) * 2)', {
          x: MathMorph.body(amount, Morph.capsule(0.62, 2.8)),
        }),
    },
  ],
});
