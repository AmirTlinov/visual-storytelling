import { BookStory } from '@visual-storytelling/core/book';
import '@visual-storytelling/core/style.css';

// Every chapter and every user input use the same measured drawing.
function describeArea({ values }) {
  const area = Number(values.width) * Number(values.height);
  return `Прямоугольник ${values.width} на ${values.height} см. Площадь: ${area} см², ${area * 4} маленьких клеток.`;
}
function area(page, frame) {
  const columns = Number(frame.values.width),
    rows = Number(frame.values.height);
  const count =
    frame.mode === 'explore'
      ? columns * rows
      : Math.min(columns * rows, Math.floor(frame.progress * (columns * rows + 2)));
  const x = 2,
    y = 2,
    blue = page.ink('blue'),
    orange = page.ink('orange');
  page.rect('rectangle', { x, y, width: columns, height: rows }, page.ink('blue', 0.07), blue);
  for (let i = 0; i < count; i++)
    page.rect(
      'unit-' + i,
      { x: x + (i % columns), y: y + Math.floor(i / columns), width: 1, height: 1 },
      page.ink(i % columns < 3 ? 'blue' : 'orange', 0.2),
      blue,
    );
  page.line('width-line', [x, y + rows + 0.5], [x + columns, y + rows + 0.5], blue);
  page.text('width', `${columns} см`, x + columns / 2, y + rows + 1.2, {
    align: 'center',
    size: 0.55,
    color: blue,
  });
  page.text('height', `${rows} см`, 1.65, y + rows / 2 + 0.2, { align: 'right', size: 0.5 });
  page.text('formula', `${columns} × ${rows} = ${columns * rows} см²`, 9.5, 3.5, {
    size: 0.82,
    color: blue,
  });
  page.text('cells', `${columns * rows * 4} маленьких клеток`, 9.5, 4.7, { size: 0.5 });
  page.rect('unit', { x: 10, y: 6.5, width: 1, height: 1 }, page.ink('orange', 0.2), orange);
  page.text('unit-explanation', '1 см² = 2 × 2 клетки', 9.5, 8.4, { size: 0.5, color: orange });
  page.text(
    'invitation',
    frame.mode === 'explore'
      ? 'Меняйте стороны — считайте вместе с рисунком.'
      : 'Каждый квадрат лежит в той же сетке.',
    2,
    10.5,
    { size: 0.53 },
  );
}
window.galleryReady = BookStory.mount(document.getElementById('tlinov-book'), {
  topic: 'Как измерить идею',
  parameters: [
    { key: 'width', label: 'Ширина, см', value: 3, min: 1, max: 6, step: 1 },
    { key: 'height', label: 'Высота, см', value: 2, min: 1, max: 5, step: 1 },
  ],
  pages: [
    {
      id: 'measure',
      title: 'Одна понятная мера',
      text: 'Четыре клетки образуют квадратный сантиметр.',
      seconds: 6,
      valuesAt: () => ({ width: 1, height: 1 }),
      describe: describeArea,
      draw: area,
    },
    {
      id: 'area',
      title: 'Складываем меры',
      text: 'Две строки по три — шесть квадратных сантиметров.',
      seconds: 7,
      valuesAt: () => ({ width: 3, height: 2 }),
      describe: describeArea,
      draw: area,
    },
    {
      id: 'change',
      title: 'Меняем стороны',
      text: 'Меняйте ширину и высоту. Клетки, рисунок и ответ остаются связаны.',
      seconds: 7,
      valuesAt: (frame) => ({ width: 3 + Math.min(2, Math.floor(frame.progress * 3)), height: 2 }),
      describe: describeArea,
      draw: area,
    },
  ],
});
