import { MorphStory, MathMorph } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

const repeat = (pattern, count) =>
  Array.from({ length: count }, (_, i) => pattern[i % pattern.length]);

window.galleryReady = MorphStory.mount(document.querySelector('main'), {
  title: 'Как множество вкладов становится числом',
  presenter: MathMorph,
  initial: { count: 32 },
  parameters: [
    {
      key: 'count',
      type: 'choice',
      label: 'Количество вкладов',
      options: [16, 32, 64].map((value) => ({ value, label: String(value) })),
    },
  ],
  script: {
    duration: 62,
    segments: [
      {
        id: 'weighted',
        title: 'Сигнал нейрона',
        start: 0,
        end: 36,
        text: 'У каждого входа свой вес. Их произведения постепенно собираются в общий сигнал.',
      },
      {
        id: 'balance',
        title: 'Доходы и расходы',
        start: 36,
        end: 62,
        text: 'Каждая запись меняет баланс. Положительные вклады прибавляются, отрицательные уменьшают сумму.',
      },
    ],
    cues: {
      weighted: { start: 2, end: 34, action: 'Умножить все входы на веса и собрать общий сигнал.' },
      balance: { start: 38, end: 60, action: 'Сложить все поступления и расходы.' },
    },
  },
  chapters: [
    {
      id: 'weighted',
      cues: 'weighted',
      operation: ({ count }) =>
        MathMorph.dot(repeat([1, 2, 3, 2], count), repeat([1, 0.5, -0.5, 1], count)),
    },
    {
      id: 'balance',
      cues: 'balance',
      operation: ({ count }) => MathMorph.calculate('add', ...repeat([3, -1, 2, -1], count)),
    },
  ],
});
