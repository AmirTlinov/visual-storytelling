import { MorphStory, InkMorph } from '@visual-storytelling/core';
import '@visual-storytelling/core/style.css';

window.galleryReady = MorphStory.mount(document.getElementById('ink-story'), {
  title: 'Как складывается образ',
  presenter: InkMorph,
  initial: { light: 'Свет', shadow: 'Тень' },
  parameters: [
    { key: 'light', label: 'Первая мысль', type: 'text' },
    { key: 'shadow', label: 'Вторая мысль', type: 'text' },
  ],
  captions: true,
  script: {
    duration: 7,
    segments: [
      {
        id: 'image',
        start: 0,
        end: 7,
        title: 'Свет и тень создают объём',
        text: 'Свет очерчивает форму, тень показывает глубину. Два слова складываются в один образ.',
      },
    ],
    cues: {
      image_change: {
        start: 1,
        end: 5,
        action: 'Штрихи света и тени соединяются в слово «Объём».',
      },
    },
  },
  chapters: [
    {
      id: 'image',
      operation: ({ light, shadow }) => ({ sources: [light, shadow], targets: ['Объём'] }),
    },
  ],
});
