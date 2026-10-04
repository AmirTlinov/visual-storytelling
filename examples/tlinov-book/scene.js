import { inkChapter } from '@visual-storytelling/core/story';
import { areaDiagram } from '@visual-storytelling/core/recipes';
import { Storybook } from '@visual-storytelling/core/book';
import '@visual-storytelling/core/style.css';

window.galleryReady = Storybook.mount(document.getElementById('tlinov-book'), {
  topic: 'Как измерить идею',
  parameters: [
    { key: 'width', label: 'Ширина, см', value: 3, min: 1, max: 6, step: 1 },
    { key: 'height', label: 'Высота, см', value: 2, min: 1, max: 5, step: 1 },
  ],
  chapters: [
    inkChapter({
      id: 'measure',
      title: 'Одна понятная мера',
      text: 'Четыре клетки образуют квадратный сантиметр.',
      seconds: 6,
      valuesAt: () => ({ width: 1, height: 1 }),
      create: areaDiagram,
    }),
    inkChapter({
      id: 'area',
      title: 'Складываем меры',
      text: 'Две строки по три — шесть квадратных сантиметров.',
      seconds: 7,
      valuesAt: () => ({ width: 3, height: 2 }),
      create: areaDiagram,
    }),
    inkChapter({
      id: 'change',
      title: 'Меняем стороны',
      text: 'Меняйте ширину и высоту. Клетки, рисунок и ответ остаются связаны.',
      seconds: 7,
      valuesAt: (frame) => ({ width: 3 + Math.min(2, Math.floor(frame.progress * 3)), height: 2 }),
      create: areaDiagram,
    }),
  ],
});
