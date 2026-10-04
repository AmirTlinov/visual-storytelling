export const lessons = [
  {
    id: 'add',
    label: '+ Сложение',
    title: 'Сложить — собрать вместе',
    expression: '2 + 2',
    answer: '4',
    question: 'У нас два шарика. Ещё два принесли.',
    action: 'Собираем обе группы вместе.',
    conclusion: 'Четыре шарика были и до движения — теперь они вместе.',
    output: 4,
  },
  {
    id: 'subtract',
    label: '− Вычитание',
    title: 'Вычесть — убрать часть',
    expression: '4 − 2',
    answer: '2',
    question: 'У нас четыре монеты. Две отдаём.',
    action: 'Отдаём две монеты из того, что есть.',
    conclusion: 'У нас осталось две монеты. Ещё две — у получателя.',
    output: 2,
  },
  {
    id: 'multiply',
    label: '× Умножение',
    title: 'Умножить — повторить группу',
    expression: '2 × 2',
    answer: '4',
    question: 'Берём группу из двух клеток два раза.',
    action: 'Повторяем эту группу ещё один раз.',
    conclusion: 'Два раза по две. Клеток стало четыре; размер каждой тот же.',
    output: 4,
  },
  {
    id: 'divide',
    label: '÷ Деление',
    title: 'Разделить — раздать поровну',
    expression: '2 ÷ 4',
    answer: '½',
    question: 'Два пирога нужно поровну разделить на четыре порции.',
    action: 'Делим пироги на равные части и раздаём по тарелкам.',
    conclusion: 'В каждой порции — половина пирога. Всего по-прежнему два пирога.',
    output: 0.5,
  },
].map((lesson, index) => ({ ...lesson, start: index * 10 }));

export const timing = {
  duration: 40,
  cues: Object.fromEntries(
    lessons.flatMap(({ id, start, question, action, conclusion }) => [
      [`${id}_look`, { start, end: start + 2, hold: question }],
      ...(id === 'divide'
        ? [
            [
              `${id}_cut`,
              {
                start: start + 2,
                end: start + 3.5,
                action: 'Два целых пирога разрезаются на четыре равные половины.',
              },
            ],
          ]
        : []),
      [`${id}_move`, { start: start + (id === 'divide' ? 3.5 : 2), end: start + 7, action }],
      [`${id}_answer`, { start: start + 7, end: start + 10, hold: conclusion }],
    ]),
  ),
};

export function lessonAt(time) {
  return lessons[Math.min(lessons.length - 1, Math.floor(Math.max(0, time) / 10))];
}
